// 완전 자동화 유료 구독 — 자동발송 일배치.
// 매시간 크론에서 호출되며, 각 지점의 send_hour 에 도달한 지점만 실제 발송한다.
// 대상: ① 온보딩(가입 후 D+N일) ② 재등록(만료 후 최근 7일).
// 안전장치: 유료 구독(isPremium) + 그룹 토글 ON 인 지점만. 채널은 설정(문자/카톡)대로.
// 중복방지: automation_dispatch_log 의 unique(branch,member,kind,step,channel) — 이미 sent 면 스킵.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../lib/env";
import { getServiceClient } from "../lib/supabase";
import { sendSms, sendFriendTalk } from "./smsNotifier";
import { isPremium } from "../lib/premium";
import { issueGuestPass, guestPassUrl, PASS_VALUE_WON } from "./guestPass";

interface AutoConfig {
  branch_id: string;
  renewal_enabled: boolean | null;
  onboarding_enabled: boolean | null;
  /** 페이스 하락(출석 빈도 급감) 회원 자동 안부. 기본 OFF */
  pace_drop_enabled?: boolean | null;
  channel_sms: boolean | null;
  channel_kakao: boolean | null;
  onboarding_steps: number[] | null;
  send_hour: number | null;
  message_tone: string | null;   // normal | heart(감동)
  /** 주간 안부 — 한 주 미방문 회원에게 응원 문자 1통. 기본 OFF */
  weekly_care_enabled?: boolean | null;
  weekly_care_dow?: number | null;         // 0=일 … 1=월(기본) … 6=토
  weekly_care_gap_days?: number | null;    // 같은 회원 재발송 최소 간격(기본 14)
  weekly_care_max_sends?: number | null;   // 회원당 총 발송 상한(기본 3)
  weekly_care_coach?: string | null;       // 발신자 이름(비우면 지점명만)
}
interface Snap {
  id: string; member_name: string | null; phone: string | null;
  start_date: string | null; end_date: string | null; status: string | null;
  /** 홀딩(일시정지) — 브로제이 원본. HOLDING 이면 자동문자 제외 */
  hold_status?: string | null;
  /** 브로제이 분류 — NEW / REREGISTRATION. 재등록은 온보딩 문구 대신 재등록 문구를 보낸다. */
  membership_type?: string | null;
  /** 브로제이 출석 이력 집계 — 페이스 하락 판정용 */
  visits_30d?: number | null;
  visits_90d?: number | null;
  /** 최근 7일 방문 — 주간 안부 대상 판정용 */
  visits_7d?: number | null;
}
/**
 * '평소보다 뜸해진' 회원인가 — 프론트 memberStats.isSlowingDown 과 같은 규칙.
 * 최근 90일 평균 한 달 방문수 대비 최근 30일이 절반 이하. 표본이 적으면(90일 6회 미만) 판단하지 않는다.
 */
function isSlowingDown(s: Snap): boolean {
  const v90 = s.visits_90d ?? null;
  const v30 = s.visits_30d ?? null;
  if (v90 == null || v30 == null || v90 < 6) return false;
  return v30 < (v90 / 3) * 0.5;
}
/** 재등록 회원 여부 */
function isRejoinMember(s: Snap): boolean {
  return (s.membership_type ?? "").toUpperCase().includes("REREG") || (s.membership_type ?? "").includes("재등록");
}
interface BranchRow { name: string | null }

/**
 * 지점당 **1회 실행** 발송 상한.
 *
 * 🚨 왜 6인가 (2026-08-11 실측):
 *   예전 값 300은 허구였다. 무료 플랜 서브리퀘스트 예산은 크론 이벤트 1회당 50인데
 *   발송 1건이 4콜(선점 insert · 발신설정 조회 · NCP 호출 · 상태 update)을 쓴다.
 *   준비 쿼리 ~13콜을 빼면 실제로는 8~9건에서 워커가 통째로 죽었다.
 *   증거: automation_dispatch_log 에 매일 'pending' 1건이 남아 다음 날 '발송 확인 불가(중단)'로
 *   확정됨(8/1·8/3·8/4·8/6·8/7·8/10). 죽는 지점이 잡 배열의 앞쪽(온보딩)이라
 *   뒤에 줄 선 페이지스 하락·주간 안부는 **60일간 한 번도 실행되지 못했다**.
 *
 *   그래서 ① 발송을 **건수가 아니라 콜 예산**으로 제한하고(준비 ~15콜 + 30 + 여유 = 50 안)
 *          ② 종류를 phase 로 쪼개 서로 다른 분(minute) 슬롯에서 각자 예산 50을 받게 한다.
 *   남은 대상은 다음 슬롯/다음 날 그대로 다시 잡힌다(선점 unique 제약이 중복을 막는다).
 *
 *   30콜 = SMS 7~8건 또는 카카오 5건. 슬롯 2개면 하루 14~16건(기존 7~8건의 2배).
 */
const SEND_CALL_BUDGET = 30;

/**
 * 실행 묶음.
 *  · primary = 온보딩 · 재등록 — **날짜가 정해진** 발송. 그날 못 나가면 그 단계는 영영 사라진다.
 *  · care    = 페이스 하락 · 주간 안부 — 안부성. 하루쯤 밀려도 손해가 없다.
 * 둘을 한 실행에 담으면 앞의 primary 가 예산을 다 쓰고 care 가 굶는다(위 참조).
 */
export type AutoPhase = "primary" | "care";

/**
 * 온보딩 7단계 — 앱의 수동 온보딩 보드(D+0/2/6/9/13/20/29)와 **날짜까지 동일**하게 맞춘다.
 * 단 하나, 첫 단계만 D+0 → D+1 로 민다. 등록 당일은 브로제이 동기화(00:05)에 아직 안 잡혀
 * D+0 발송이 대부분 비기 때문이다. 그 뒤 단계는 이미 며칠 지난 시점이라 밀 이유가 없다.
 *
 * ⚠️ 예전 설정(5단계 [1,3,7,14,30])을 저장해 둔 지점도 그대로 동작한다.
 *    문구는 '며칠째냐'가 아니라 stepKey() 로 고르므로, 단계를 몇 개 쓰든 이야기가 겹치지 않는다.
 */
const DEFAULT_STEPS = [1, 2, 6, 9, 13, 20, 29];

type OnbKey = "welcome" | "basics" | "week1" | "buddy" | "class" | "onepoint" | "finish";
/** D+N → 어떤 이야기를 할 차례인가. 구간으로 잡아 예전 설정값도 각각 다른 문구를 받는다. */
function stepKey(day: number): OnbKey {
  if (day <= 1) return "welcome";
  if (day <= 4) return "basics";
  if (day <= 8) return "week1";
  if (day <= 11) return "buddy";
  if (day <= 16) return "class";
  if (day <= 24) return "onepoint";
  return "finish";
}

function kstDateStr(offsetDays = 0): string {
  return new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400000).toISOString().slice(0, 10);
}
function kstHour(): number {
  return new Date(Date.now() + 9 * 3600 * 1000).getUTCHours();
}
function digits(p: string | null): string { return (p ?? "").replace(/\D/g, ""); }
function dayNum(d: string): number { return Math.floor(Date.parse(`${d.slice(0, 10)}T00:00:00+09:00`) / 86400000); }

// 온보딩 D+N 문구 — 긍정어만 사용. 선택에 대한 칭찬 + 건강 + 행복을 담는다.
// 각 단계 끝에 '운동·건강의 가치' 한 줄(VALUE_LINES)을 붙여 왜 계속할 가치가 있는지 전한다.
//
// ⚠️ 인용 원칙: 출처가 분명한 말만 인물명을 붙이고(무하마드 알리),
//    나머지는 '~라는 말이 있어요' 형태의 속담·격언으로만 쓴다. 없는 말을 유명인에게 붙이지 않는다.
const VALUE_LINES = {
  start: "'천 리 길도 한 걸음부터'라는 말처럼, 오늘의 한 걸음이 일 년 뒤의 건강이 됩니다.",
  early: "몸을 움직인 날은 생각도 가볍고 잠도 깊어져요. 건강은 그렇게 하루씩 쌓입니다.",
  week: "무하마드 알리는 '챔피언은 체육관이 아니라 그 사람 안에 있는 무언가로 만들어진다'고 했어요. 오겠다고 마음먹은 그 힘이 이미 실력입니다.",
  habit: "운동은 의지보다 습관이 이겨요. '가는 날'이 쌓이면 몸이 먼저 기억합니다.",
  month: "'첫 번째 재산은 건강이다'라는 말이 있어요. 한 달 동안 {이름}님은 그 재산을 성실히 모으셨습니다.",
  keep: "체력은 쓸수록 늘어나는 신기한 자산이에요. 오늘의 운동은 미래의 나에게 미리 보내는 선물입니다.",
} as const;
const withName = (s: string, nm: string) => s.split("{이름}").join(nm);

/**
 * 직원이 직접 연락한 뒤 며칠간 자동발송을 멈출지.
 * 3일 = "코치가 그저께 문자했는데 오늘 앱이 또 보내는" 상황까지 막는 선.
 * 늘리면 자동발송이 많이 줄고, 줄이면 중복이 는다.
 */
const STAFF_CONTACT_COOLDOWN_DAYS = 3;

function onboardingBody(name: string, center: string, step: number): string {
  const nm = name || "회원";
  const v = (k: keyof typeof VALUE_LINES) => withName(VALUE_LINES[k], nm);
  switch (stepKey(step)) {
    case "welcome":
      return `${nm}님, ${center}과 함께하기로 해주셔서 감사합니다! 건강을 위해 시작하기로 한 오늘의 선택이 참 멋집니다. ${v("start")} 편한 옷차림으로 오시면 코치가 옆에서 함께할게요!`;
    case "basics":
      return `${nm}님, 며칠 나와보니 어떠세요? 몸이 새 움직임을 배우는 반가운 시기예요. ${v("early")} 핸드랩 감기부터 스탠스, 줄넘기까지 코치가 하나씩 함께 잡아드립니다. 이번 주 2~3번이면 리듬이 잡혀요!`;
    case "week1":
      return `${nm}님, 벌써 일주일이에요! 첫 주를 채우신 것만으로 훌륭하십니다. ${v("week")} 폼·자세는 코치가 즐겁게 봐드릴게요. 응원합니다!`;
    case "buddy":
      // 지인 동반 — 혜택 안내형. 답장을 기다리지 않고 초대권 링크를 바로 준다.
      //   답장형은 '보내드릴게요' 뒤에 사람이 또 움직여야 해서 절반이 새어 나간다.
      return `${nm}님, ${center}입니다. 혼자보다 함께하는 운동이 훨씬 오래갑니다.\n\n{이름}님께 드리는 게스트 초대권 1장을 보내드려요. ${PASS_VALUE_WON.toLocaleString()}원 상당 무료 체험권이고, 같이 오고 싶은 분께 링크를 그대로 전달하시면 됩니다.\n{link}\n\n소중한 분께 건강을 선물하세요.`.replace("{이름}", nm);
    case "class":
      return `${nm}님, 2주 차예요! 점점 익숙해지고 계시죠? ${v("habit")} 이제 미트·초급 스파링·다이어트 복싱 같은 클래스에서 재미를 붙이기 좋은 때예요. 관심 있는 수업 이름을 답장으로 알려주세요!`;
    case "onepoint":
      return `${nm}님, 3주째 이어오고 계신 게 정말 대단하십니다. 지금 자세를 한 번 더 다듬으면 운동이 한결 편하고 재밌어져요. 코치 1:1 원포인트를 원하시면 답장 주세요. 시간 맞춰 준비해둘게요!`;
    default:
      return `${nm}님, 한 달 가까이 함께했어요! 처음보다 체력도 자세도 확실히 좋아지셨습니다. ${v("month")} 앞으로도 ${center}가 곁에서 함께하겠습니다!`;
  }
}
function renewalBody(name: string, center: string): string {
  const nm = name || "회원";
  return `${nm}님, ${center}입니다. 그동안 꾸준히 함께해 주셔서 감사합니다! ${withName(VALUE_LINES.keep, nm)} 이어서 하시면 지금의 좋은 컨디션을 그대로 살려갈 수 있어요. 연장 혜택 안내해 드릴게요. 편하게 답장 주세요.`;
}

/**
 * 재등록 회원 전용 문구 — 신규 온보딩과 분리.
 * 재등록도 이용권 시작일이 새로 잡혀 '신규'로 잡히는데,
 * 이미 우리를 아는 분들에게 '등록을 환영합니다'가 나가면 실례가 된다.
 */
function rejoinBody(name: string, center: string, step: number): string {
  const nm = name || "회원";
  if (step <= 1) return `${nm}님, 이번에도 ${center}과 함께해 주셔서 진심으로 감사합니다. 건강을 계속 챙기기로 한 선택이 정말 멋지십니다. ${withName(VALUE_LINES.keep, nm)} 이번 기간 목표 하나만 알려주시면 거기에 맞춰 즐겁게 준비하겠습니다.`;
  if (step <= 7) return `${nm}님, ${center}입니다. 다시 함께한 지 일주일이 되었어요. ${withName(VALUE_LINES.habit, nm)} 몸이 리듬을 빠르게 기억하는 시기라 지금 루틴을 잡아두면 훨씬 가볍고 즐겁습니다. 편한 요일·시간대를 알려주시면 맞춰 잡아드릴게요.`;
  return `${nm}님, ${center}입니다. 꾸준히 이어가고 계신 모습이 참 보기 좋습니다. ${withName(VALUE_LINES.month, nm)} 지금 강도와 클래스가 잘 맞는지 점검해드리고 더 즐겁게 이어가실 수 있게 도와드릴게요.`;
}

/**
 * 페이스 하락 안부 — 아직 다니는 중인데 빈도가 줄어든 회원.
 * ⚠️ 절대 지적하지 않는다("요즘 안 나오시네요" 금지). 바쁜 사정을 먼저 인정하고,
 *    다시 오는 문턱을 낮춰주는 문장으로만 구성한다.
 * 문구는 별도 본문이 아니라 **선정된 안부 4문구(WEEKLY_CARE)를 그대로 로테이션**한다 — 톤 무관.
 */
// 회원 id → 작은 해시. 문구 로테이션 분산용(보안 목적 아님).
function idHash(id: string): number { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h; }

// ── 감동(heart) 톤 — 명언·진심을 담아 출석/재등록 동기를 부드럽게 ──
function onboardingBodyHeart(name: string, center: string, step: number): string {
  const nm = name || "회원";
  switch (stepKey(step)) {
    case "welcome":
      return `${nm}님, ${center}입니다. 첫 발을 내디딘 것만으로 이미 절반은 오신 거예요. '모든 챔피언도 한때는 초보였다'고 하죠. 건강을 위해 시작하기로 한 그 선택이 참 멋집니다. 오늘의 시작을 진심으로 응원해요.`;
    case "basics":
      return `${nm}님, ${center}예요. 며칠 나와보니 어떠세요? 몸이 새롭게 변하고 있다는 반가운 신호가 느껴지실 거예요. 잘하는 것보다 '오는 것' 자체가 실력이에요. '건강한 신체에 건강한 정신이 깃든다'는 말처럼, 움직인 날은 마음까지 가벼워집니다. 그 걸음, 저희가 끝까지 함께할게요.`;
    case "week1":
      return `${nm}님, ${center}입니다. 벌써 일주일이에요. '천 리 길도 한 걸음부터'라죠 — ${nm}님은 이미 그 걸음을 리듬으로 만들고 계세요. 지금 이 시기가 습관이 자리잡는 가장 소중한 때예요. 응원합니다.`;
    case "buddy":
      return `${nm}님, ${center}입니다. 함께 땀 흘리는 사람이 곁에 있으면 운동이 훨씬 오래갑니다.\n\n{이름}님께 게스트 초대권 1장을 드려요. ${PASS_VALUE_WON.toLocaleString()}원 상당 무료 체험권입니다. 같이 운동하고 싶은 분께 링크를 보내주세요.\n{link}\n\n소중한 분께 건강을 선물하세요.`.replace("{이름}", nm);
    case "class":
      return `${nm}님, ${center}예요. 2주 차네요. 운동은 완벽함보다 꾸준함이더라고요. ${nm}님은 그걸 해내고 계세요. 이제 클래스에서 한 걸음 더 나가보셔도 좋을 시기예요. 관심 있는 수업 알려주시면 맞춰 준비하겠습니다.`;
    case "onepoint":
      return `${nm}님, ${center}입니다. 3주째네요. 이 시기에 자세를 한 번 다듬어두면 다음 한 달이 확실히 편해집니다. 코치가 옆에서 봐드릴 시간을 잡아둘게요. 편하신 요일만 알려주세요.`;
    default:
      return `${nm}님, ${center}입니다. 한 달 가까이 함께했어요. 작은 약속을 지킨 하루하루가 오늘의 ${nm}님을 만들었어요. '첫 번째 재산은 건강이다'라는 말처럼, 그 하루하루가 통장 대신 몸에 쌓였습니다. 그 꾸준함이 가장 큰 재능이에요. 앞으로의 길도 저희가 곁에서 함께하겠습니다.`;
  }
}
function renewalBodyHeart(name: string, center: string): string {
  const nm = name || "회원";
  return `${nm}님, ${center}입니다. '챔피언은 이미 자기 안에 있던 무언가가 드러난 것뿐'이라죠. 지난 기간 {이름}님이 보여주신 꾸준함이 그 증거였어요. 그 흐름, 여기서 멈추기엔 아까워 조심스레 인사드려요. 다시 이어가고 싶으시면 편하게 답장 주세요.`.replace("{이름}", nm);
}

/**
 * 주간 안부 4종 — 한 주 동안 한 번도 안 나온 회원에게 보내는 응원 문자.
 *
 * 설계 원칙
 *  · 결석을 언급하지 않는다. "안 나오셨네요"는 관찰당한 느낌을 준다.
 *  · 방문·답장을 요구하지 않는다(4번만 함께하자는 제안으로 닫는다).
 *  · 할인·이벤트를 넣지 않는다. 안부가 영업이 되는 순간 진심이 사라진다.
 * 회원마다 무작위로 하나가 나가되, 같은 사람에게 같은 문구가 다시 가지 않게 고른다.
 */
/** 발신자 표기 — 코치 이름이 설정돼 있으면 "153복싱짐 선릉점 김코치", 없으면 지점명만 */
function sender(center: string, coach: string): string {
  const c = (coach ?? "").trim();
  return c ? `${center} ${c}` : center;
}
const WEEKLY_CARE: ((name: string, center: string, coach: string) => string)[] = [
  (nm, c, coach) =>
    `${nm}님, ${sender(c, coach)}입니다.\n\n운동이 ${nm}님의 하루를 조금 더 가볍게 만들어드렸으면 합니다.\n\n몸이 편해지면 마음도 따라오더라고요.\n${nm}님 건강하고 행복하시길 바랍니다.`,
  (nm, c, coach) =>
    `${nm}님, ${sender(c, coach)}입니다.\n\n건강하셨으면 좋겠습니다.\n그리고 그 건강으로 하고 싶으신 걸 다 하셨으면 좋겠습니다.\n\n운동은 그걸 돕는 일이라 생각하고 있습니다.`,
  (nm, c, coach) =>
    `${nm}님, ${sender(c, coach)}입니다.\n\n저희는 ${nm}님이 얼마나 자주 오시는지보다 ${nm}님이 건강하신지가 더 궁금합니다.\n\n운동으로 건강하고 행복해지시는 것, 그게 저희가 여기 있는 이유입니다.`,
  (nm, c, coach) =>
    `${nm}님, ${sender(c, coach)}입니다.\n\n잘 지내시죠.\n운동하시면서 몸도 마음도 편안해지시길 진심으로 바랍니다.\n\n운동습관 같이 만들어봐요~`,
];

/**
 * 아직 한 번도 안 나온 신규 회원용 문구.
 *
 * 왜 필요한가 (2026-08-04, 실제 항의로 발견):
 *   온보딩 문구는 등록일 D+N 만 보고 나가는데 본문은 출석을 **단정**한다
 *   ("며칠 나와보니 어떠세요", "벌써 일주일이에요! 첫 주를 채우신 것만으로").
 *   결제만 하고 한 번도 못 온 회원이 이걸 받으면 "등록한 적도 없는데 운동 중이라고 온다"로 읽힌다.
 *   실제로 한 회원 배우자분이 그렇게 받아들여 환불 문의로 이어졌다.
 *
 * 원칙
 *  · 안 왔다고 지적하지 않는다. "아직 안 오셨네요"는 감시당한 느낌을 준다.
 *  · 첫 방문의 문턱을 낮추는 정보만 준다(준비물 없음·시간·코치가 붙는다).
 *  · 할인·독촉을 넣지 않는다.
 */
function firstVisitBody(name: string, center: string, step: number): string {
  const nm = name || "회원";
  if (step <= 3) {
    return `${nm}님, ${center}입니다. 등록해 주셔서 감사합니다!\n첫날은 준비물 없이 편한 옷차림만 오시면 됩니다. 운동화도 대여해 드려요.\n처음 오시는 날은 코치가 처음부터 끝까지 옆에서 함께하니 편하게 오세요. 편하신 시간 알려주시면 맞춰 준비해두겠습니다.`;
  }
  if (step <= 14) {
    return `${nm}님, ${center}입니다. 시작이 제일 어렵더라고요.\n첫날만 넘기면 그다음은 훨씬 수월해집니다. 30분만 하고 가셔도 괜찮아요.\n오시기 편한 요일·시간 하나만 알려주시면 코치 시간을 비워두겠습니다.`;
  }
  return `${nm}님, ${center}입니다. 바쁘셨죠.\n이용 기간이 지나가고 있어 조심스레 안내드려요 — 아직 한 번도 못 오셨다면 시작일을 뒤로 미뤄드리거나 정지해 드릴 수 있습니다.\n편하신 방법으로 답장 주시면 바로 처리해 드리겠습니다.`;
}

interface Job { snap: Snap; kind: "onboarding" | "renewal" | "pace_drop" | "weekly_care"; step: number; body: string }

async function runBranch(db: SupabaseClient, env: Env, cfg: AutoConfig, phase: AutoPhase): Promise<{ sent: number; failed: number; skipped: number }> {
  const hour = kstHour();
  const stat = { sent: 0, failed: 0, skipped: 0 };
  // 지점이 설정한 발송 시각에만 (기본 11시)
  if (hour !== (cfg.send_hour ?? 11)) return stat;
  // 심야 금지도 여기서 미리 컷 — 루프 안에만 두면 준비 쿼리 15콜을 다 쓰고 한 건도 못 보낸다
  // (send_hour 를 7시나 22시로 설정한 지점). 아래 루프의 채널별 가드는 그대로 둔다.
  if (hour < 8 || hour >= 21) return stat;

  const channels: ("sms" | "kakao")[] = [];
  if (cfg.channel_sms !== false) channels.push("sms");   // 기본 문자 ON
  if (cfg.channel_kakao === true) channels.push("kakao");
  if (channels.length === 0) return stat;

  const heart = cfg.message_tone === "heart";   // 감동 톤 여부
  const onBody = (nm: string, c: string, d: number) => heart ? onboardingBodyHeart(nm, c, d) : onboardingBody(nm, c, d);
  const reBody = (nm: string, c: string) => heart ? renewalBodyHeart(nm, c) : renewalBody(nm, c);

  const { data: br } = await db.from("branches").select("name").eq("id", cfg.branch_id).maybeSingle();
  const center = (br as BranchRow | null)?.name ?? "153복싱짐";
  const coachName = (cfg.weekly_care_coach ?? "").trim();   // 주간 안부·페이스 하락 발신자 이름

  // 대상 수집
  // 수신거부·연락금지 회원 차단셋 — fc_send_state(stopped: optout/service_issue) + fc_member_inputs(opt_out/do_not_contact)
  const blocked = new Set<string>();
  {
    // ⚠️ fail-closed — 차단셋을 못 읽으면 발송하지 않는다.
    //    supabase-js 는 오류를 throw 하지 않고 {error} 로 반환하므로 catch 는 사문이었다.
    //    조회가 실패했는데 발송하면 수신거부 회원에게 유료 문자가 나간다(권한 사고 전례 있는 DB다).
    const { data: stop, error: e1 } = await db.from("fc_send_state")
      .select("normalized_phone").eq("branch_id", cfg.branch_id).eq("status", "stopped").limit(5000);
    const { data: opt, error: e2 } = await db.from("fc_member_inputs")
      .select("normalized_phone").eq("branch_id", cfg.branch_id).or("opt_out.eq.true,do_not_contact.eq.true").limit(5000);
    if (e1 || e2) {
      console.error("[automationRunner] 차단셋 조회 실패 — 이 지점 발송 건너뜀", cfg.branch_id, e1?.message ?? e2?.message);
      return stat;   // 이 지점은 이번 회차 발송하지 않는다(다음 시간에 재시도)
    }
    for (const r of (stop as { normalized_phone: string | null }[] | null) ?? []) if (r.normalized_phone) blocked.add(digits(r.normalized_phone));
    for (const r of (opt as { normalized_phone: string | null }[] | null) ?? []) if (r.normalized_phone) blocked.add(digits(r.normalized_phone));

    /**
     * 🚨 최근에 **직원이 직접 연락한** 회원은 자동발송에서 뺀다 (2026-08 대표님 지적).
     *
     * 실제로 겹쳤다: 7/29 코치가 회원케어 문자를 보냈는데 7/30 앱이 온보딩 D+3 을 또 보냈다.
     * 회원 입장에선 이틀 연속 같은 곳에서 문자가 온다. 코치 미션(careQueue)은 자동발송분을
     * 이미 보고 피하는데, 반대로 자동발송이 코치 연락을 안 봐서 한쪽만 새고 있었다.
     *
     * ⚠️ `created_by is not null` = 직원이 보낸 것만. 자동발송(created_by null)까지 막으면
     *    온보딩 D+1 → D+3 처럼 **제 시퀀스가 스스로를 막아** 온보딩이 통째로 멈춘다.
     */
    const sinceContact = new Date(Date.now() - STAFF_CONTACT_COOLDOWN_DAYS * 86400000).toISOString();
    const { data: recent, error: e3 } = await db.from("ops_message_logs")
      .select("phone")
      .eq("branch_id", cfg.branch_id)
      .not("created_by", "is", null)
      .gte("created_at", sinceContact)
      .limit(3000);
    if (e3) {
      console.error("[automationRunner] 최근 연락 조회 실패 — 이 지점 발송 건너뜀", cfg.branch_id, e3.message);
      return stat;   // 못 읽었으면 보내지 않는다(중복 발송보다 한 회차 거르는 게 낫다)
    }
    for (const r of (recent as { phone: string | null }[] | null) ?? []) {
      const d = digits(r.phone ?? "");
      if (d.length >= 9) blocked.add(d);
    }
  }

  // hold_status=HOLDING(브로제이 일시정지)은 status가 '유효'로 남아 상태필터를 통과하므로 여기서 거른다
  const eligible = (s: Snap): boolean =>
    digits(s.phone).length >= 9 && !blocked.has(digits(s.phone)) && s.hold_status !== "HOLDING";
  const jobs: Job[] = [];

  if (phase === "primary" && cfg.onboarding_enabled) {
    const stepsRaw = (Array.isArray(cfg.onboarding_steps) && cfg.onboarding_steps.length ? cfg.onboarding_steps : DEFAULT_STEPS);
    /**
     * 단계 순서를 날짜로 **회전**시킨다.
     * [1,2,6,9,13,20,29] 고정 순서로 넣으면 예산 상한에 걸릴 때 항상 뒤쪽(D+20·D+29)이 잘리고,
     * D+N 은 하루 지나면 재시도가 없어 **후반 온보딩이 구조적으로 0건**이 된다.
     */
    const rot = ((dayNum(kstDateStr(0)) % stepsRaw.length) + stepsRaw.length) % stepsRaw.length;
    const steps = [...stepsRaw.slice(rot), ...stepsRaw.slice(0, rot)];
    /**
     * 🚨 실제로 나온 사람만 '나오고 계시죠' 라고 부른다.
     * 이 지점의 최근 출입 번호를 한 번만 읽어 두고(단계마다 조회하면 쿼리가 7배), 없는 사람은 첫방문 문구로 바꾼다.
     * ⚠️ PostgREST 는 .limit() 을 걸어도 1000행에서 자른다 — 자르면 '온 사람'이 안 온 사람으로 뒤집혀
     *    정상 회원에게 "아직 못 오셨다면" 문자가 나간다. 그래서 .range() 로 전량을 읽는다.
     */
    const visited = new Set<string>();
    /**
     * 명단을 **끝까지 못 읽었으면** 첫방문 판정을 아예 쓰지 않는다.
     * 반쪽 명단으로 판정하면 이미 다니는 회원이 '아직 안 오신 분'으로 뒤집혀
     * "아직 못 오셨다면" 문자가 나간다(실제 항의 사례). 그럴 바엔 일반 온보딩 문구가 낫다.
     * 페이지 상한 10 = 1만 행(하루 320방문×31일) — 그 이상이면 예산(50콜)이 더 위험하다.
     */
    let visitedComplete = true;
    {
      const maxStep = Math.max(...steps, 1);
      const sinceIso = new Date(Date.now() - (maxStep + 2) * 86400000).toISOString();
      let off = 0;
      for (; off < 10000; off += 1000) {
        const { data: av, error: ae } = await db.from("attendance_logs")
          .select("phone").eq("branch_id", cfg.branch_id).eq("counts_as_visit", true)
          .gte("attended_at", sinceIso).order("phone", { ascending: true }).range(off, off + 999);
        if (ae) { console.error("[automationRunner] 출입 조회 실패 — 첫방문 판정 생략", cfg.branch_id, ae.message); visitedComplete = false; break; }
        const arr = (av as { phone: string | null }[] | null) ?? [];
        for (const r of arr) if (r.phone) visited.add(digits(r.phone));
        if (arr.length < 1000) break;
        if (off + 1000 >= 10000) { console.error("[automationRunner] 출입 기록 과다 — 첫방문 판정 생략", cfg.branch_id); visitedComplete = false; }
      }
    }
    for (const d of steps) {
      const { data } = await db.from("member_snapshots")
        .select("id, member_name, phone, start_date, end_date, status, membership_type, hold_status")
        .eq("branch_id", cfg.branch_id).eq("start_date", kstDateStr(-d))
        .not("status", "in", "(만료,미등록,홀딩,정지)").limit(500);   // 만료·미등록·홀딩(정지)은 온보딩 제외
      for (const s of (data as Snap[] | null) ?? []) {
        if (!eligible(s)) continue;
        // 재등록 회원에게는 '환영·기본기' 온보딩이 아니라 재등록 전용 문구를 보낸다.
        // 단, 재등록 문구는 3구간(D+1 복귀환영 · D+6 리듬 · D+20 유지)뿐이라
        // 7단계 전부 보내면 같은 문장이 최대 4번 나간다 → 3단계에서만 발송.
        const rejoin = isRejoinMember(s);
        if (rejoin && d !== 1 && d !== 6 && d !== 20) continue;
        // D+1(환영)은 출석을 단정하지 않으니 그대로. D+3 이후는 실제 방문이 있어야 그 문구를 쓴다.
        const neverCame = visitedComplete && d > 1 && !visited.has(digits(s.phone));
        const body = neverCame
          ? firstVisitBody(s.member_name ?? "", center, d)
          : rejoin ? rejoinBody(s.member_name ?? "", center, d) : onBody(s.member_name ?? "", center, d);
        // 초대권({link}) 발급은 디스패치 루프에서 '선점 성공 후'에 한다 —
        // 여기서 미리 발급하면 크론이 중간에 죽었을 때 문자 없는 유령 초대권이 남는다(2026-07-30 실제 발생).
        jobs.push({ snap: s, kind: "onboarding", step: d, body });
      }
    }
  }

  if (phase === "primary" && cfg.renewal_enabled) {
    // 최근 7일 내 만료 — 만료일 기준 사이클당 1회(step=만료일 일수). 홀딩(일시정지)·미등록은 제외(만료 아님).
    const { data } = await db.from("member_snapshots")
      .select("id, member_name, phone, start_date, end_date, status, hold_status")
      .eq("branch_id", cfg.branch_id).gte("end_date", kstDateStr(-7)).lte("end_date", kstDateStr(0))
      .not("status", "in", "(홀딩,미등록,정지)").limit(1000);
    for (const s of (data as Snap[] | null) ?? []) {
      if (!eligible(s) || !s.end_date) continue;
      const step = dayNum(s.end_date);
      if (!Number.isFinite(step)) continue;   // 만료일 파싱 실패 → step null 되면 중복방지 무력화되므로 스킵
      jobs.push({ snap: s, kind: "renewal", step, body: reBody(s.member_name ?? "", center) });
    }
  }

  /**
   * 🚨 같은 날 안부가 두 통 가는 것을 막는다 (검수 지적, 2026-08-11).
   * 페이스 하락 대상은 대부분 '이번 주 0회'도 만족한다 → 두 블록이 같은 회원을 집는다.
   * kind 가 달라 DB unique 제약도, 선점 사전필터도 이걸 못 막고,
   * 게다가 두 문구가 같은 WEEKLY_CARE 풀이라 **똑같은 문장이 두 번** 갈 수 있다.
   */
  const careTaken = new Set<string>();

  if (phase === "care" && cfg.pace_drop_enabled) {
    // 페이스 하락 — 아직 이용권이 살아있는데 출석 빈도가 평소 절반 이하로 떨어진 회원.
    // 이탈은 만료 전에 '출석 빈도'부터 떨어지므로, 이 시점의 안부가 가장 잘 통한다.
    //
    // ⚠️ 회원당 30일에 1회만 — step 을 30일 버킷으로 잡아 unique 제약이 쿨다운 역할을 한다.
    //    (매일 크론이 돌아도 같은 버킷이면 선점 충돌로 스킵된다)
    const today0 = kstDateStr(0);
    const bucket = Math.floor(dayNum(today0) / 30);
    const { data } = await db.from("member_snapshots")
      .select("id, member_name, phone, start_date, end_date, status, visits_30d, visits_90d, hold_status")
      .eq("branch_id", cfg.branch_id)
      .gte("end_date", today0)                       // 이용권이 살아있는 회원만
      .gte("visits_90d", 6)                          // 표본 부족 제외
      .not("status", "in", "(만료,미등록,홀딩,정지)")
      .limit(1000);
    for (const s of (data as Snap[] | null) ?? []) {
      // 컬럼 간 비교는 서버 필터로 안 되므로 여기서 최종 판정
      if (!eligible(s) || !isSlowingDown(s)) continue;
      // 선정된 안부 4문구 로테이션 — step(30일 버킷)은 쿨다운 역할 그대로 두고,
      // 문구는 회원+주기 해시로 골라 같은 회원이 주기마다 다른 문구를 받는다.
      const pick = (idHash(s.id) + bucket) % WEEKLY_CARE.length;
      careTaken.add(s.id);
      jobs.push({ snap: s, kind: "pace_drop", step: bucket, body: WEEKLY_CARE[pick]!(s.member_name ?? "회원", center, coachName) });
    }
  }

  if (phase === "care" && cfg.weekly_care_enabled) {
    // 주간 안부 — 최근 7일 방문 0회인 유효 회원에게 4개 문구 중 하나.
    //
    // ⚠️ 매일 크론이 도는데 조건이 '이번 주 0회'라 매일 대상이 잡힌다. 그래서 3중으로 잠근다.
    //    ① 지정 요일에만 실행  ② 회원당 최소 간격(기본 14일)  ③ 회원당 총 발송 상한(기본 3회)
    //    간격·상한이 없으면 안부가 잔소리가 되고, 안 오는 분을 끝까지 따라다니게 된다.
    const dow = new Date(Date.now() + 9 * 3600 * 1000).getUTCDay();   // 0=일 … 6=토 (KST)
    if (dow === (cfg.weekly_care_dow ?? 1)) {
      const today0 = kstDateStr(0);
      const gap = Math.max(7, cfg.weekly_care_gap_days ?? 14);
      const maxSends = Math.max(1, cfg.weekly_care_max_sends ?? 3);

      // 과거 발송 이력 — 간격·상한·이미 쓴 문구를 한 번에 판정한다.
      //
      // ⚠️ fail-closed 필수. weekly_care 는 step 이 '문구 번호'라 unique 제약이 같은 날 재발송을
      //    막지 못한다. 동일일 중복을 막는 유일한 방어가 아래 gap 체크인데, 이 조회가 실패하면
      //    맵이 비어 모든 게이트를 통과한다. care 슬롯이 하루 두 번(:30·:50) 도는 지금은
      //    조회 한 번만 실패해도 같은 회원에게 두 통이 나간다.
      const { data: hist, error: he } = await db.from("automation_dispatch_log")
        .select("member_id, step, dispatched_on")
        .eq("branch_id", cfg.branch_id).eq("kind", "weekly_care")
        .gte("dispatched_on", kstDateStr(-400))
        .limit(20000);
      if (he) console.error("[automationRunner] 주간안부 이력 조회 실패 — 이번 회차 건너뜀", cfg.branch_id, he.message);
      else {
      const sentCount = new Map<string, number>();
      const lastDay = new Map<string, string>();
      const usedVariant = new Map<string, Set<number>>();
      for (const h of (hist as { member_id: string | null; step: number | null; dispatched_on: string | null }[] | null) ?? []) {
        if (!h.member_id) continue;
        sentCount.set(h.member_id, (sentCount.get(h.member_id) ?? 0) + 1);
        if (h.dispatched_on && (lastDay.get(h.member_id) ?? "") < h.dispatched_on) lastDay.set(h.member_id, h.dispatched_on);
        if (h.step != null) {
          const s = usedVariant.get(h.member_id) ?? new Set<number>();
          s.add(h.step); usedVariant.set(h.member_id, s);
        }
      }

      const { data } = await db.from("member_snapshots")
        .select("id, member_name, phone, start_date, end_date, status, visits_7d, hold_status")
        .eq("branch_id", cfg.branch_id)
        .gte("end_date", today0)                        // 이용권이 살아있는 회원만
        .eq("visits_7d", 0)                             // 이번 주 한 번도 안 옴 (null = 미동기화는 제외)
        .not("status", "in", "(만료,미등록,홀딩,정지)")
        .limit(1000);

      for (const s of (data as Snap[] | null) ?? []) {
        if (!eligible(s)) continue;
        if (careTaken.has(s.id)) continue;                                          // 오늘 페이스하락으로 이미 나감
        if ((sentCount.get(s.id) ?? 0) >= maxSends) continue;                       // 상한 도달
        const last = lastDay.get(s.id);
        if (last && dayNum(today0) - dayNum(last) < gap) continue;                  // 간격 미달
        // 아직 안 쓴 문구 중에서 무작위 — 다 썼으면 전체에서 무작위
        const used = usedVariant.get(s.id) ?? new Set<number>();
        const pool = WEEKLY_CARE.map((_, i) => i).filter((i) => !used.has(i));
        const idxs = pool.length ? pool : WEEKLY_CARE.map((_, i) => i);
        const pick = idxs[Math.floor(Math.random() * idxs.length)]!;
        jobs.push({
          snap: s, kind: "weekly_care", step: pick,
          body: WEEKLY_CARE[pick]!(s.member_name ?? "회원", center, coachName),
        });
      }
      }
    }
  }

  if (jobs.length === 0) return stat;

  const today = kstDateStr(0);
  /**
   * 이미 선점된 슬롯은 **미리** 걸러낸다 — 충돌 insert 도 서브리퀘스트 1콜을 먹기 때문.
   *
   * ⚠️ 키는 DB unique 제약과 **똑같이** (member, kind, step, channel) 여야 한다.
   *    · channel 을 빼면: SMS 만 보낸 회원의 카카오분까지 걸러져 영영 안 나간다.
   *    · 오늘 날짜만 보면: step 이 날짜와 무관한 kind(재등록=만료일, 페이스하락=30일 버킷)가
   *      매일 다시 큐에 실려 충돌 insert 로 예산을 통째로 태운다. 그래서 40일 창으로 읽는다.
   */
  const seen = new Set<string>();
  {
    const { data: done } = await db.from("automation_dispatch_log")
      .select("member_id, kind, step, channel")
      .eq("branch_id", cfg.branch_id)
      .gte("dispatched_on", kstDateStr(-40))     // pace_drop 30일 버킷 + 여유
      .limit(5000);
    for (const d of (done as { member_id: string | null; kind: string | null; step: number | null; channel: string | null }[] | null) ?? []) {
      seen.add(`${d.member_id}|${d.kind}|${d.step}|${d.channel}`);
    }
  }
  const key = (j: Job, ch: string) => `${j.snap.id}|${j.kind}|${j.step}|${ch}`;
  // 아직 남은 채널이 하나라도 있는 잡만 남긴다
  let queue = seen.size ? jobs.filter((j) => channels.some((ch) => !seen.has(key(j, ch)))) : jobs;
  if (queue.length === 0) return stat;

  /**
   * 종류를 **교대로** 배치한다(라운드로빈).
   * 그냥 두면 배열 순서가 온보딩 → 재등록 이라, 상한에 걸릴 때 재등록이 매일 0건이 된다.
   * 재등록은 만료일 기준 8일 창이라 8일 내내 밀리면 그 회원 문자는 영영 안 나간다.
   */
  {
    const byKind = new Map<string, Job[]>();
    for (const j of queue) { const a = byKind.get(j.kind) ?? []; a.push(j); byKind.set(j.kind, a); }
    if (byKind.size > 1) {
      const lanes = [...byKind.values()];
      const mixed: Job[] = [];
      for (let i = 0; mixed.length < queue.length; i++) for (const lane of lanes) if (lane[i]) mixed.push(lane[i]!);
      queue = mixed;
    }
  }

  /**
   * 서브리퀘스트 **콜 예산**으로 센다(건수가 아니라).
   * SMS 1건 = 선점 insert 1 + 발신설정 조회 1 + NCP 1 + 상태 update 1 = 4콜
   * 카카오 1건 = 위 + 채널ID·비즈메시지ID 조회 2 = 6콜
   * 건수로 세면 카카오 지점은 6건 = 36콜이라 준비분과 합쳐 한도 50을 넘어 워커가 죽는다.
   */
  const CALL_COST: Record<string, number> = { sms: 4, kakao: 6 };
  let budget = SEND_CALL_BUDGET;
  let count = 0;
  const opsRows: Record<string, unknown>[] = [];   // 연락 이력 — 마지막에 한 번에 기록(잡당 서브리퀘스트 1개 절약)
  for (const job of queue) {
    if (budget < 4) break;
    const phone = digits(job.snap.phone);
    for (const ch of channels) {
      const cost = CALL_COST[ch] ?? 4;
      if (budget < cost) break;
      if (seen.has(key(job, ch))) { stat.skipped++; continue; }   // 이 채널은 이미 나감(insert 없이 스킵)
      // 검수 반영(boxer): 심야 발송 금지는 채널 공통(KST 08~21시) — SMS 도 예외 없음
      // (buddy 초대권·연장 혜택 등 광고성 소지 본문이 존재. fc.ts 가드와 정합).
      if (hour < 8 || hour >= 21) { stat.skipped++; continue; }
      // 카카오 광고는 발송사 야간 제한(20:50~)에 걸리지 않게 20시 마감(fc.ts nightStart=20 과 통일)
      if (ch === "kakao" && hour >= 20) { stat.skipped++; continue; }
      // ── 선점(claim): 발송 '전에' unique(branch,member,kind,step,channel) 슬롯을 잡는다.
      //    이미 처리된 건이면 insert 가 충돌해 claim=null → 스킵. 크론이 중복 실행돼도
      //    이중발송이 원천 불가능(발송 후 기록이 아니라 발송 전 선점이라 레이스가 없다).
      const { data: claim } = await db.from("automation_dispatch_log").insert({
        branch_id: cfg.branch_id, member_id: job.snap.id, member_name: job.snap.member_name,
        phone, kind: job.kind, step: job.step, channel: ch, status: "pending", dispatched_on: today,
      }).select("id").maybeSingle();
      budget -= 1;                                // 충돌해도 콜은 이미 썼다 — 예산에서 먼저 뺀다
      if (!claim) { stat.skipped++; continue; }   // 이미 발송/처리됨(충돌) 또는 삽입 실패
      budget -= cost - 1;                         // 남은 비용(발신설정·전송·상태update)
      count++;
      // 초대권({link})은 선점 성공 후 발급 — 유령 초대권 방지. 재사용 로직이 있어 중복 발급도 없다.
      let body = job.body;
      if (body.includes("{link}")) {
        const pass = await issueGuestPass(db, {
          branchId: cfg.branch_id, name: job.snap.member_name, phone: job.snap.phone, source: "onboarding",
        });
        if (!pass) {
          stat.failed++;
          await db.from("automation_dispatch_log")
            .update({ status: "failed", error: "초대권 발급 실패" }).eq("id", (claim as { id: string }).id);
          continue;
        }
        body = body.replace("{link}", guestPassUrl(pass.slug));
      }
      let res: { success: boolean; error?: string };
      try {
        res = ch === "kakao"
          ? await sendFriendTalk(db, env, cfg.branch_id, phone, body, { isAd: true })
          : await sendSms(db, env, cfg.branch_id, phone, body);
      } catch (e) {
        res = { success: false, error: e instanceof Error ? e.message : "send error" };
      }
      if (res.success) stat.sent++; else stat.failed++;
      await db.from("automation_dispatch_log")
        .update({ status: res.success ? "sent" : "failed", error: res.error ?? null })
        .eq("id", (claim as { id: string }).id);
      opsRows.push({
        branch_id: cfg.branch_id, recipient_name: job.snap.member_name, phone,
        template_type: `auto_${job.kind}_${job.step}`, content: body,
        status: res.success ? "sent" : "failed",
      });
    }
  }
  // 회원 연락 이력 일괄 기록(best-effort)
  if (opsRows.length) { try { await db.from("ops_message_logs").insert(opsRows); } catch { /* 무시 */ } }
  // 상한에 걸려 남은 대상 — 다음 슬롯/다음 날 그대로 다시 잡힌다(선점 unique 가 중복을 막는다).
  // 이 숫자가 매일 쌓이면 슬롯을 늘려야 한다는 신호다.
  if (queue.length > count) console.log("[automationRunner] 예산 소진 — 다음 슬롯 대기", { branch: cfg.branch_id, phase, 발송: count, 대기: queue.length - count, 기발송제외: jobs.length - queue.length, 잔여콜: budget });
  return stat;
}

/**
 * 크론에서 호출 — 유료 구독 + 자동화 ON 인 지점만 처리.
 *
 * phase 로 종류를 나눠 **서로 다른 분(minute) 슬롯**에서 부른다(index.ts 참조).
 * 한 실행에 다 담으면 앞의 온보딩이 서브리퀘스트 예산 50을 다 쓰고 뒤의 안부가 굶는다.
 */
export async function runAutomationDaily(env: Env, phase: AutoPhase = "primary"): Promise<void> {
  const db = getServiceClient(env);
  // 이전 날짜의 미완료 선점(pending) 정리 — 크론 중단으로 '발송 후 상태갱신 실패'한 유령 행일 수 있다.
  // 지우면(재시도) 이미 보낸 재등록 문자를 다음 날 다시 보낼 위험이 있으므로, 지우지 않고 'failed'로 확정한다.
  // (슬롯을 유지해 재선점·이중발송을 막고, 리포트 실패목록에 노출해 수동 확인을 유도한다.)
  // primary 슬롯에서만 — care 에서도 하면 예산 1콜을 매번 헛되이 쓴다.
  if (phase === "primary") {
    try { await db.from("automation_dispatch_log").update({ status: "failed", error: "발송 확인 불가(중단)" }).eq("status", "pending").lt("dispatched_on", kstDateStr(0)); }
    catch { /* 무시 */ }
  }
  const { data, error } = await db.from("fc_automation_config")
    .select("branch_id, renewal_enabled, onboarding_enabled, pace_drop_enabled, weekly_care_enabled, weekly_care_dow, weekly_care_gap_days, weekly_care_max_sends, weekly_care_coach, channel_sms, channel_kakao, onboarding_steps, send_hour, message_tone")
    .or(phase === "primary"
      ? "renewal_enabled.eq.true,onboarding_enabled.eq.true"
      : "pace_drop_enabled.eq.true,weekly_care_enabled.eq.true");
  if (error) { console.error("[automationDaily] config fetch:", error.message); return; }
  const configs = (data as AutoConfig[] | null) ?? [];
  const hourNow = kstHour();
  let sent = 0, failed = 0;
  for (const cfg of configs) {
    try {
      // 발송 시각 컷을 구독 조회보다 **먼저** — 안 그러면 하루 46회의 헛 실행마다 지점 수만큼 콜을 태운다
      if (hourNow !== (cfg.send_hour ?? 11)) continue;
      if (!(await isPremium(db, cfg.branch_id))) continue;   // 구독 게이트 (조회 실패 시 이 지점만 스킵)
      const r = await runBranch(db, env, cfg, phase);
      sent += r.sent; failed += r.failed;
    } catch (e) {
      console.error("[automationDaily] branch", cfg.branch_id, e instanceof Error ? e.message : e);
    }
  }
  if (sent || failed) console.log("[automationDaily]", { phase, branches: configs.length, sent, failed });
}

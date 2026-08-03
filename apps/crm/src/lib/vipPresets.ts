// VIP 초대장 프리셋 — 버전별 편지·명예 뱃지·혜택·양식을 자동으로 채운다.
// 지점 관리자는 프리셋 하나 고르고 이름만 넣으면 끝. 나머지는 전부 자동.
// 렌더러(153-boxing-os/vip)는 기존 VipData 필드만 그리므로 값만 프리셋별로 바꾼다(구조 불변).

export interface VipPreset {
  key: string;
  label: string;      // 관리자 화면용 이름
  emoji: string;
  desc: string;       // 어떤 회원에게 보내는지 한 줄
  ev: string;         // 대회/이벤트명 (증서 문구 "…를 빛낸"에 들어가므로 받침 없는 어미로)
  title: string;      // 표지 대형 영문
  roman: string;      // 회차 로마숫자 (없으면 "")
  coh: string;        // 증서 종류 영문 (Certificate of …)
  awardKo: string;    // 뱃지 한글
  awardEn: string;    // 뱃지 영문
  disc: number;       // 할인율
  guestN: number;     // 게스트 초대권 매수
  guestEach: string;  // 1매 금액
  guestTotal: string; // 총액
  closing: string;    // 맺음말
  noPrefix: string;   // 증서번호 접두어
  benefits: string[];
  conds: string[];
  amb: [string, string][];
  auto?: "loyal_1y" | "loyal_2y" | "welcome"; // 데이터로 자동 후보 분류 가능한 프리셋 표시
  letter: (name: string, br: string, ev: string) => string[];
}

const AMB: [string, string][] = [
  ["1개월", "게스트 1개월 등록 시 — VIP 회원 7일 + 게스트 7일 연장"],
  ["3개월", "게스트 3개월 등록 시 — VIP 회원 15일 + 게스트 15일 연장"],
  ["5+개월", "게스트 5개월 이상 등록 시 — VIP 회원 1개월 + 게스트 1개월 연장"],
];
const COND_BASE = [
  "혜택권은 발급일로부터 1년 이내 사용",
  "타 할인·이벤트와 중복 사용 불가",
  "현금 교환 및 양도 불가",
];

export const VIP_PRESETS: VipPreset[] = [
  {
    key: "champion", label: "대회 우승", emoji: "🏆", desc: "생활체육대회 우승·입상 회원",
    ev: "오픈 첫 생활체육대회", title: "FOUNDING FIGHTER", roman: "VII", coh: "Certificate of Honor",
    awardKo: "우승", awardEn: "CHAMPION", disc: 20, guestN: 2, guestEach: "30,000", guestTotal: "60,000",
    closing: "다음 대회에서 또 만나요.", noPrefix: "FF7-",
    benefits: [
      "Champion Bonus Week 20% 할인권 · 본인 이용권 20% 할인",
      "VIP 게스트 초대권 2매 · 총 60,000원 상당",
      "다음 대회 준비반 우선 안내",
      "게스트 등록 시 VIP 회원 추가 연장",
      "153 Ambassador 혜택 · 등록 기간별 VIP·게스트 동시 연장",
    ],
    conds: [...COND_BASE, "게스트 초대권은 첫 방문 고객에 한해 사용 가능"], amb: AMB,
    letter: (name, br, ev) => [
      `${br} ${ev}, 그 링 위에서 끝까지 물러서지 않은 ${name} 님의 모습을 저희는 오래 기억합니다. 그 용기가 '우승'이라는 값진 결과로 남았습니다.`,
      `축하와 감사의 마음을 담아 153이 작은 선물을 준비했습니다. 아래 증서와 혜택은 ${name} 님을 위한 것입니다.`,
      "함께해 주셔서 진심으로 감사합니다. 다음 라운드도 153이 끝까지 곁을 지키겠습니다.",
    ],
  },
  {
    key: "runnerup", label: "대회 준우승·감투", emoji: "🥈", desc: "끝까지 싸운 준우승·감투상 회원",
    ev: "오픈 첫 생활체육대회", title: "BRAVE FIGHTER", roman: "VII", coh: "Certificate of Honor",
    awardKo: "감투상", awardEn: "BRAVE HEART", disc: 20, guestN: 2, guestEach: "30,000", guestTotal: "60,000",
    closing: "그 투지, 다음 무대에서 빛납니다.", noPrefix: "BF7-",
    benefits: [
      "Fighter Bonus Week 20% 할인권 · 본인 이용권 20% 할인",
      "VIP 게스트 초대권 2매 · 총 60,000원 상당",
      "다음 대회 준비반 우선 안내",
      "게스트 등록 시 VIP 회원 추가 연장",
      "153 Ambassador 혜택 · 등록 기간별 VIP·게스트 동시 연장",
    ],
    conds: [...COND_BASE, "게스트 초대권은 첫 방문 고객에 한해 사용 가능"], amb: AMB,
    letter: (name, br, ev) => [
      `${br} ${ev}, 마지막 라운드까지 링을 지켜낸 ${name} 님의 그 마음이 결과보다 먼저 기억에 남았습니다. 끝까지 포기하지 않은 파이트로 값진 자리에 올랐습니다.`,
      `우승 못지않은 그 투지에 보답하고 싶어 153이 선물을 준비했습니다. 혜택은 우승자와 동일하게 담았습니다. 아래 증서와 혜택은 ${name} 님을 위한 것입니다.`,
      "오늘의 투지가 다음 무대의 출발선이 되리라 믿습니다. 그 길, 153이 끝까지 함께하겠습니다.",
    ],
  },
  {
    key: "arena_debut", label: "대회 첫 출전", emoji: "🔰", desc: "생활체육대회에 처음 도전한 회원",
    ev: "첫 생활체육대회", title: "ARENA DEBUT", roman: "", coh: "Certificate of Courage",
    awardKo: "첫 출전", awardEn: "CHALLENGER", disc: 15, guestN: 1, guestEach: "30,000", guestTotal: "30,000",
    closing: "첫 출전, 그 자체가 승리입니다.", noPrefix: "AD-",
    benefits: [
      "Debut Bonus 15% 할인권 · 본인 이용권 15% 할인",
      "VIP 게스트 초대권 1매 · 30,000원 상당",
      "다음 대회 준비반 우선 안내",
      "1:1 자세 점검 1회 무료",
      "153 Ambassador 혜택 · 게스트 등록 시 동시 연장",
    ],
    conds: [...COND_BASE, "게스트 초대권은 첫 방문 고객에 한해 사용 가능"], amb: AMB,
    letter: (name, br, ev) => [
      `${br} ${ev}, 링에 처음 오르는 그 한 걸음이 가장 큰 용기였습니다. ${name} 님이 보여준 도전, 그 자체가 이미 값진 승리였습니다.`,
      `결과를 떠나 링에 오른 모든 분께 153은 같은 존경을 담습니다. ${name} 님을 위한 작은 선물과 혜택을 준비했습니다.`,
      "오늘의 첫 출전이 다음 무대의 시작이 되도록, 153이 끝까지 함께하겠습니다.",
    ],
  },
  {
    key: "loyal_1y", label: "1년 이상 감사", emoji: "🎗️", desc: "1년 넘게 함께한 회원 감사", auto: "loyal_1y",
    ev: "1년의 이야기", title: "ONE YEAR", roman: "", coh: "Certificate of Loyalty",
    awardKo: "1년 감사", awardEn: "LOYAL MEMBER", disc: 25, guestN: 1, guestEach: "30,000", guestTotal: "30,000",
    closing: "다음 1년도 곁에서 함께하겠습니다.", noPrefix: "LY1-",
    benefits: [
      "Loyalty 25% 할인권 · 재등록·연장 시 25% 할인",
      "VIP 게스트 초대권 1매 · 30,000원 상당",
      "감사 기념 굿즈 증정",
      "체성분 측정 + 목표 점검 1회 무료",
      "153 Ambassador 혜택 · 게스트 등록 시 동시 연장",
    ],
    conds: COND_BASE, amb: AMB,
    letter: (name, br) => [
      `${name} 님, 어느새 ${br}과 함께한 지 1년이 되었습니다. 바쁜 하루 속에서도 꾸준히 링을 찾아주신 그 시간이 저희에게는 큰 힘이었습니다.`,
      `한 해 동안 보여주신 성실함과 믿음에 감사드리며, 153이 작은 보답을 준비했습니다. 아래 증서와 혜택은 ${name} 님을 위한 것입니다.`,
      `앞으로의 1년도, 그 다음도 ${br}이 ${name} 님의 곁을 지키겠습니다. 늘 감사합니다.`,
    ],
  },
  {
    key: "loyal_2y", label: "오랜 인연(장기)", emoji: "💎", desc: "2년 이상 함께한 베테랑 회원", auto: "loyal_2y",
    ev: "오랜 인연의 이야기", title: "LOYAL VETERAN", roman: "", coh: "Certificate of Loyalty",
    awardKo: "오랜 인연", awardEn: "VETERAN", disc: 30, guestN: 2, guestEach: "30,000", guestTotal: "60,000",
    closing: "오래 함께해 주셔서 감사합니다.", noPrefix: "LY2-",
    benefits: [
      "Veteran 30% 할인권 · 재등록·연장 시 30% 할인",
      "VIP 게스트 초대권 2매 · 총 60,000원 상당",
      "감사 기념 프리미엄 굿즈 증정",
      "PT·특강 우선 예약권",
      "153 Ambassador 혜택 · 게스트 등록 시 동시 연장",
    ],
    conds: COND_BASE, amb: AMB,
    letter: (name, br) => [
      `${name} 님, ${br}과 함께한 시간이 벌써 여러 해가 되었습니다. 한결같이 자리를 지켜주신 그 꾸준함은 아무나 해낼 수 없는 일입니다.`,
      `오랜 인연에 깊이 감사드리며, 153이 베테랑 회원님을 위한 특별한 예우를 준비했습니다. 아래 증서와 혜택을 받아주세요.`,
      `지금까지 그래왔듯, 앞으로도 ${br}은 ${name} 님과 오래 함께하겠습니다. 진심으로 감사합니다.`,
    ],
  },
  {
    key: "ambassador", label: "소개왕·영향력", emoji: "🤝", desc: "여러 회원을 소개해 준 회원",
    ev: "153 앰배서더", title: "AMBASSADOR", roman: "", coh: "Certificate of Gratitude",
    awardKo: "소개왕", awardEn: "AMBASSADOR", disc: 25, guestN: 3, guestEach: "30,000", guestTotal: "90,000",
    closing: "당신의 한마디가 153을 키웁니다.", noPrefix: "AMB-",
    benefits: [
      "Ambassador 25% 할인권 · 본인 이용권 25% 할인",
      "VIP 게스트 초대권 3매 · 총 90,000원 상당",
      "소개 회원 등록 시 추가 연장 혜택",
      "감사 기념 굿즈 증정",
      "153 Ambassador 혜택 · 등록 기간별 VIP·게스트 동시 연장",
    ],
    conds: [...COND_BASE, "게스트 초대권은 첫 방문 고객에 한해 사용 가능"], amb: AMB,
    letter: (name, br) => [
      `${name} 님, 좋은 사람들을 ${br}으로 이끌어주셔서 진심으로 감사합니다. ${name} 님의 따뜻한 한마디가 누군가의 건강한 습관의 시작이 되었습니다.`,
      `그 영향력에 보답하고자 153이 앰배서더 예우를 준비했습니다. 아래 혜택은 ${name} 님과 함께 오실 분들을 위한 것입니다.`,
      `${name} 님 덕분에 153은 더 단단해졌습니다. 그 마음, 저희가 오래 기억하겠습니다.`,
    ],
  },
  {
    key: "attendance_king", label: "출석왕", emoji: "🔥", desc: "가장 꾸준히 나온 성실 회원",
    ev: "한결같은 하루하루", title: "IRON WILL", roman: "", coh: "Certificate of Dedication",
    awardKo: "출석왕", awardEn: "IRON WILL", disc: 20, guestN: 1, guestEach: "30,000", guestTotal: "30,000",
    closing: "꾸준함은 재능을 이깁니다.", noPrefix: "IW-",
    benefits: [
      "Iron Will 20% 할인권 · 재등록·연장 시 20% 할인",
      "VIP 게스트 초대권 1매 · 30,000원 상당",
      "출석왕 기념 굿즈 증정",
      "PT·특강 우선 예약권",
      "153 Ambassador 혜택 · 게스트 등록 시 동시 연장",
    ],
    conds: COND_BASE, amb: AMB,
    letter: (name, br) => [
      `${name} 님, 비가 오나 눈이 오나 링을 찾아주신 그 발걸음을 ${br}은 매일 지켜보았습니다. 꾸준함은 재능을 이깁니다.`,
      `누구보다 성실했던 ${name} 님께 153이 '출석왕'의 이름으로 작은 선물을 드립니다. 아래 증서와 혜택을 받아주세요.`,
      "오늘의 그 성실함이 내일의 실력이 됩니다. 그 길, 153이 끝까지 함께하겠습니다.",
    ],
  },
  {
    key: "comeback", label: "재등록·복귀 감사", emoji: "🔄", desc: "다시 돌아온 복귀 회원",
    ev: "다시 시작하는 이야기", title: "WELCOME BACK", roman: "", coh: "Certificate of Return",
    awardKo: "복귀 환영", awardEn: "COMEBACK", disc: 20, guestN: 1, guestEach: "30,000", guestTotal: "30,000",
    closing: "이번엔 더 오래, 더 즐겁게.", noPrefix: "CB-",
    benefits: [
      "Comeback 20% 할인권 · 재등록·연장 시 20% 할인",
      "VIP 게스트 초대권 1매 · 30,000원 상당",
      "복귀 기념 체성분 측정 + 목표 재설정 1회 무료",
      "PT 체험 1회 제공",
      "153 Ambassador 혜택 · 게스트 등록 시 동시 연장",
    ],
    conds: COND_BASE, amb: AMB,
    letter: (name, br) => [
      `${name} 님, 다시 링으로 돌아와 주셔서 진심으로 반갑습니다. 잠시 쉬어가도 다시 시작하는 그 용기가 가장 멋진 일입니다.`,
      `다시 함께하게 된 것을 기념하며 153이 복귀 선물을 준비했습니다. 지난 시간의 감각, 금방 되찾으실 겁니다.`,
      `이번엔 더 오래, 더 즐겁게. ${br}이 ${name} 님의 페이스에 맞춰 끝까지 함께하겠습니다.`,
    ],
  },
  {
    key: "welcome", label: "신규 웰컴", emoji: "🎉", desc: "새로 등록한 신규 회원 환영", auto: "welcome",
    ev: "첫 라운드", title: "WELCOME", roman: "", coh: "Welcome Certificate",
    awardKo: "신규 환영", awardEn: "NEW MEMBER", disc: 10, guestN: 1, guestEach: "30,000", guestTotal: "30,000",
    closing: "153의 새 식구가 되신 걸 환영합니다.", noPrefix: "WEL-",
    benefits: [
      "Welcome 10% 할인권 · 등록 기간 내 재등록 시 10% 할인 (유효기간 = 회원권 종료일)",
      "VIP 게스트 초대권 1매 · 30,000원 상당",
      "웰컴 굿즈 증정",
      "1:1 기초 자세 점검 1회 무료",
      "153 Ambassador 혜택 · 게스트 등록 시 동시 연장",
    ],
    conds: COND_BASE, amb: AMB,
    letter: (name, br) => [
      `${name} 님, ${br}의 새 식구가 되신 것을 진심으로 환영합니다. 첫 글러브를 끼는 그 설렘을 저희가 오래 기억하겠습니다.`,
      `시작을 응원하는 마음으로 153이 웰컴 선물을 준비했습니다. 처음이 편해야 오래갈 수 있으니까요. 아래 혜택은 ${name} 님을 위한 것입니다.`,
      `무리하지 않아도 괜찮습니다. ${br}이 ${name} 님의 첫걸음부터 끝까지 함께하겠습니다.`,
    ],
  },
  {
    key: "birthday", label: "생일 축하", emoji: "🎂", desc: "생일 맞은 회원 축하",
    ev: "오늘 하루", title: "HAPPY BIRTHDAY", roman: "", coh: "Birthday Certificate",
    awardKo: "생일 축하", awardEn: "BIRTHDAY", disc: 20, guestN: 1, guestEach: "30,000", guestTotal: "30,000",
    closing: "생일 진심으로 축하드립니다.", noPrefix: "BD-",
    benefits: [
      "Birthday 20% 할인권 · 다음 등록·연장 시 20% 할인",
      "VIP 게스트 초대권 1매 · 30,000원 상당",
      "생일 기념 굿즈 증정",
      "체성분 측정 + 목표 점검 1회 무료",
      "153 Ambassador 혜택 · 게스트 등록 시 동시 연장",
    ],
    conds: COND_BASE, amb: AMB,
    letter: (name, br) => [
      `${name} 님, 생일을 진심으로 축하드립니다. ${br}과 함께하는 특별한 하루가 되시길 바랍니다.`,
      `한 살 더 건강해지는 한 해를 응원하며 153이 생일 선물을 준비했습니다. 아래 증서와 혜택은 ${name} 님을 위한 것입니다.`,
      `올해도 ${br}이 ${name} 님의 건강과 성장을 곁에서 응원하겠습니다. 생일 축하드려요.`,
    ],
  },
];

export function presetByKey(key: string): VipPreset {
  return VIP_PRESETS.find((p) => p.key === key) ?? VIP_PRESETS[0]!;
}

// 프리셋 → 전체 VipData 재구성 (렌더러가 짧은 링크를 펼칠 때 / 앱이 diff 할 때 공용)
export interface VipBase { n: string; no: string; d: string; v: string; r: string; re: string; br: string; brEn: string; gymEn: string; tel: string; sign: string; }
export function presetToFull(p: VipPreset, b: VipBase): Record<string, unknown> {
  return {
    n: b.n, r: b.r, re: b.re, no: b.no, d: b.d, v: b.v,
    ev: p.ev, br: b.br, brEn: b.brEn, gymEn: b.gymEn, coh: p.coh, title: p.title, roman: p.roman,
    disc: String(p.disc), guestN: String(p.guestN), guestEach: p.guestEach, guestTotal: p.guestTotal,
    amb: p.amb, benefits: p.benefits, conds: p.conds, tel: b.tel, sign: b.sign, closing: p.closing,
    L: p.letter(b.n || "회원", b.br, p.ev),
  };
}
const MIN_SCALARS = ["ev", "title", "roman", "coh", "disc", "guestN", "guestEach", "guestTotal", "closing"] as const;
// 링크 최소화: 프리셋 키 + 회원 고유값 + (프리셋 기본과 다른 = 수동편집) 필드만 담는다.
export function buildMinPreset(full: Record<string, unknown>, presetKey: string, defaults: Record<string, unknown>): Record<string, unknown> {
  const p = presetByKey(presetKey);
  const s = (x: unknown) => String(x == null ? "" : x);
  const base: VipBase = {
    n: s(full.n), no: s(full.no), d: s(full.d), v: s(full.v), r: s(full.r), re: s(full.re),
    br: s(full.br), brEn: s(full.brEn), gymEn: s(full.gymEn), tel: s(full.tel), sign: s(full.sign),
  };
  const exp = presetToFull(p, base);
  const min: Record<string, unknown> = { p: presetKey, n: base.n, no: base.no, d: base.d, v: base.v };
  for (const k of ["br", "brEn", "tel", "sign", "gymEn"]) if (s(full[k]) !== s(defaults[k])) min[k] = full[k];
  if (base.r !== p.awardKo) min.r = full.r;
  if (base.re !== p.awardEn) min.re = full.re;
  for (const k of MIN_SCALARS) if (s(full[k]) !== s(exp[k])) min[k] = full[k];
  for (const k of ["benefits", "conds", "amb", "L"]) if (JSON.stringify(full[k]) !== JSON.stringify(exp[k])) min[k] = full[k];
  return min;
}

export interface VipCandidate { name: string; phone: string | null; note: string; validUntil?: string; }
export interface VipCandidateGroup { preset: string; label: string; emoji: string; members: VipCandidate[]; }

// 기존 회원 데이터(member_snapshots)로 자동 분류 — 1년+/2년+/신규만 데이터로 가능. 출석왕·소개왕은 데이터 없어 수동.
export interface VipMemberLike { member_name: string; phone: string | null; start_date: string | null; end_date: string | null; }
export function classifyVipCandidates(members: VipMemberLike[], nowMs: number): VipCandidateGroup[] {
  const DAY = 86400000;
  const g2: VipCandidate[] = [], g1: VipCandidate[] = [], gw: VipCandidate[] = [];
  for (const m of members) {
    if (!m.member_name) continue;
    const sd = m.start_date ? Date.parse(m.start_date.replace(/\./g, "-")) : NaN;
    const ed = m.end_date ? Date.parse(m.end_date.replace(/\./g, "-")) : NaN;
    const active = isNaN(ed) || ed >= nowMs - DAY; // 만료 회원 제외
    if (!active || isNaN(sd)) continue;
    const days = Math.floor((nowMs - sd) / DAY);
    if (days >= 730) g2.push({ name: m.member_name, phone: m.phone, note: Math.floor(days / 365) + "년째 함께" });
    else if (days >= 365) g1.push({ name: m.member_name, phone: m.phone, note: "1년 이상 (" + days + "일)" });
    else if (days >= 0 && days <= 30) gw.push({ name: m.member_name, phone: m.phone, note: "신규 " + days + "일차", validUntil: m.end_date ? m.end_date.replace(/-/g, ".") : undefined });
  }
  const out: VipCandidateGroup[] = [];
  const p2 = presetByKey("loyal_2y"), p1 = presetByKey("loyal_1y"), pw = presetByKey("welcome");
  if (g2.length) out.push({ preset: p2.key, label: p2.label, emoji: p2.emoji, members: g2 });
  if (g1.length) out.push({ preset: p1.key, label: p1.label, emoji: p1.emoji, members: g1 });
  if (gw.length) out.push({ preset: pw.key, label: pw.label, emoji: pw.emoji, members: gw });
  return out;
}

// 프리셋별 카톡 인사말(링크 앞 2줄). VipInvite가 뒤에 링크·서명을 붙인다.
const KAKAO: Record<string, (n: string) => string> = {
  champion: (n) => `${n} 님, 값진 우승을 진심으로 축하드립니다.\n153이 준비한 감사 선물을 보내드려요. 편지와 VIP 혜택이 담겨 있으니 천천히 열어봐 주세요.`,
  runnerup: (n) => `${n} 님, 끝까지 싸운 그 파이트에 박수를 보냅니다.\n우승 못지않은 투지에 준비한 선물이에요. 천천히 열어봐 주세요.`,
  arena_debut: (n) => `${n} 님, 첫 출전 그 용기에 진심으로 박수를 보냅니다.\n도전을 응원하는 153의 작은 선물이에요. 열어봐 주세요.`,
  loyal_1y: (n) => `${n} 님, 1년 동안 함께해 주셔서 진심으로 감사합니다.\n작은 보답을 준비했어요. 편지와 혜택을 천천히 열어봐 주세요.`,
  loyal_2y: (n) => `${n} 님, 오랜 시간 함께해 주셔서 진심으로 감사합니다.\n베테랑 회원님을 위한 예우를 담았어요. 천천히 열어봐 주세요.`,
  ambassador: (n) => `${n} 님, 좋은 분들을 153으로 이끌어주셔서 감사합니다.\n앰배서더 예우를 준비했어요. 편지와 혜택을 열어봐 주세요.`,
  attendance_king: (n) => `${n} 님, 누구보다 꾸준했던 그 발걸음에 박수를 보냅니다.\n출석왕 선물을 준비했어요. 천천히 열어봐 주세요.`,
  comeback: (n) => `${n} 님, 다시 돌아와 주셔서 진심으로 반가워요.\n복귀를 환영하는 선물을 준비했어요. 열어봐 주세요.`,
  welcome: (n) => `${n} 님, 153의 새 식구가 되신 걸 환영합니다.\n웰컴 선물을 준비했어요. 편지와 혜택을 천천히 열어봐 주세요.`,
  birthday: (n) => `${n} 님, 생일 진심으로 축하드립니다.\n생일 선물을 준비했어요. 편지와 혜택을 천천히 열어봐 주세요.`,
};
export function presetKakao(p: VipPreset, name: string): string {
  const f = KAKAO[p.key];
  const nm = name || "회원";
  return f ? f(nm) : `${nm} 님께 153이 감사 선물을 보내드려요. 편지와 혜택을 천천히 열어봐 주세요.`;
}

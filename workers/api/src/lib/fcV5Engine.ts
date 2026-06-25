// 153복싱짐 선릉점 Lifecycle·VIP·Winback 결정 엔진 V5 (TypeScript 포팅)
// 원본: 04_ENGINE/fc_lifecycle_vip_winback_engine.py (표준 라이브러리, 599줄)
// - 회원별 30일 온보딩·VIP·기프트·종료 D30/D60/D90 판단을 재현 가능한 규칙으로 계산
// - 자동 발송/자동 지급은 하지 않는다. 운영 임계값은 지점 실데이터로 조정.
// - 순수 함수. Cloudflare/Supabase 의존성 없음. 파이썬 레퍼런스 출력과 1:1 일치 검증.

export interface V5MemberInput {
  member_id?: string | null;
  member_name?: string | null;
  phone?: string | null;
  owner_fc?: string | null;
  owner_coach?: string | null;
  first_join_date?: string | null;
  join_date?: string | null;
  end_date?: string | null;
  target_visits_per_week?: number | string | null;
  visits_total?: number | string | null;
  visits_7d?: number | string | null;
  visits_14d?: number | string | null;
  visits_30d?: number | string | null;
  visits_90d?: number | string | null;
  previous_30d_visits?: number | string | null;
  last_visit_date?: string | null;
  next_booking?: string | null;
  satisfaction?: number | string | null;
  complaint?: boolean | string | null;
  payment_issue?: boolean | string | null;
  goal?: string | null;
  barrier?: string | null;
  ad_consent?: boolean | string | null;
  opt_out?: boolean | string | null;
  do_not_contact?: boolean | string | null;
  membership_revenue?: number | string | null;
  pt_revenue?: number | string | null;
  other_revenue?: number | string | null;
  refund?: number | string | null;
  referral_inquiries?: number | string | null;
  referral_registrations?: number | string | null;
  referral_revenue?: number | string | null;
  reviews?: number | string | null;
  community_contribution?: number | string | null;
  gift_cost_365d?: number | string | null;
  last_vip_care_date?: string | null;
  manual_vip_tier?: string | null;
  end_reason?: string | null;
  return_interest?: string | null;
  return_declined?: boolean | string | null;
  recontact_date?: string | null;
  last_post_end_contact_date?: string | null;
  post_end_sales_contacts_90d?: number | string | null;
  preferred_gift_key?: string | null;
  [key: string]: unknown;
}

export interface GiftItem { name: string; cost: number; valid_days: number; active: boolean }
export type GiftCatalog = Record<string, GiftItem>;

export interface V5Settings {
  today?: string;
  default_target_visits_per_week?: number;
  minimum_satisfaction?: number;
  vip_thresholds?: { SILVER: number; GOLD: number; BLACK: number };
  ambassador_min_referrals?: number;
  care_cycle_days?: Record<string, number>;
  gift_cap?: Record<string, number>;
  default_gift?: Record<string, string>;
  minimum_post_end_contact_gap_days?: number;
  max_post_end_sales_contacts_90d?: number;
  winback_windows?: Record<string, [number, number]>;
}

export interface GiftRecommendation {
  gift_key: string;
  gift_name: string;
  unit_cost: number;
  valid_days: number;
  annual_cap: number;
  used_cost_365d: number;
  remaining_budget: number;
  reason: string;
  requires_approval: boolean;
}

export interface V5Result {
  member_id: string;
  member_name: string;
  data_issues: string[];
  lifecycle_stage: string;
  service_gate: string;
  send_gate: string;
  attendance_rate_90d: number;
  tenure_months: number;
  realized_ltv: number;
  vip_score: number;
  vip_score_parts: Record<string, number>;
  vip_tier: string;
  vip_archetype: string;
  vip_care_due_date: string | null;
  gift_recommendation: GiftRecommendation;
  days_after_end: number | null;
  winback_cohort: string | null;
  winback_score: number;
  winback_probability_band: string;
  winback_segment: string;
  next_action: string;
  template_key: string;
  priority: number;
  crm_note: string;
  // ── V6 재등록 확률·원클릭 라우팅 (가산) ──
  renewal_probability: number;     // 0~1 재등록 추정확률
  renewal_band: string;            // 높음 / 중간 / 낮음
  expected_ticket: number;         // 예상 객단가(회원권매출/누적결제건수)
  expected_revenue: number;        // 확률 × 객단가
  days_to_expiry: number | null;   // 만료까지 남은 일(음수=경과)
  days_expired: number;            // 종료 후 경과일(0=미종료)
  renewal_route: string;           // 라우팅 라벨
  renewal_rule_id: string;         // R0xx
  renewal_template_key: string;    // V6 메시지 키
  renewal_product_key: string;     // 추천 상품키(P1/P3/P6/P12/SAME/NONE)
  renewal_coupon_key: string;      // GUEST1/GUEST2/NONE
  renewal_gate: string;            // V6 게이트(광고발송가능/정보성만/서비스회복/연락차단/...)
}

export const DEFAULTS: Required<V5Settings> = {
  today: "2026-06-24",
  default_target_visits_per_week: 2,
  minimum_satisfaction: 4,
  vip_thresholds: { SILVER: 45, GOLD: 60, BLACK: 75 }, // 153복싱짐 규모 보정(2026-06-25)
  ambassador_min_referrals: 3,
  care_cycle_days: { SILVER: 90, GOLD: 60, BLACK: 45, AMBASSADOR: 30 },
  gift_cap: { SILVER: 30000, GOLD: 60000, BLACK: 120000, AMBASSADOR: 180000 },
  default_gift: { SILVER: "GUEST1", GOLD: "GUEST1", BLACK: "GUEST2", AMBASSADOR: "GUEST2" },
  minimum_post_end_contact_gap_days: 14,
  max_post_end_sales_contacts_90d: 3,
  winback_windows: { "30일": [27, 33], "60일": [57, 63], "90일": [87, 93] },
};

export const GIFT_CATALOG = {
  GUEST1: { name: "게스트 1회 초대권", cost: 10000, valid_days: 30, active: true },
  GUEST2: { name: "게스트 2회 초대권", cost: 20000, valid_days: 30, active: true },
  COACH15: { name: "코치 기술점검 15분", cost: 0, valid_days: 30, active: true },
  GOAL20: { name: "운동목표 리셋 상담 20분", cost: 0, valid_days: 30, active: true },
  ANNIV: { name: "등록기념 감사카드·메시지", cost: 3000, valid_days: 14, active: true },
  NONE: { name: "기프트 없음·감사 케어만", cost: 0, valid_days: 0, active: true },
} satisfies GiftCatalog;

// ── 유틸 ──
export function num(value: unknown, dflt = 0): number {
  if (value === null || value === undefined || value === "") return dflt;
  if (typeof value === "boolean") return value ? 1 : 0;
  const n = Number(String(value).replace(/,/g, "").trim());
  return Number.isNaN(n) ? dflt : n;
}

export function truthy(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined) return false;
  return ["y", "yes", "true", "1", "예", "네", "동의", "있음"].includes(String(value).trim().toLowerCase());
}

export function parseDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value;
  const text = String(value).trim().slice(0, 10).replace(/[/.]/g, "-");
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayDiff(later: Date, earlier: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / 86400000);
}

// 파이썬 round (round-half-to-even) 재현 — 레퍼런스 일치용
export function pyRound(x: number, ndigits = 0): number {
  const m = Math.pow(10, ndigits);
  const v = x * m;
  const floor = Math.floor(v);
  const diff = v - floor;
  let r: number;
  const eps = 1e-9;
  if (diff > 0.5 + eps) r = floor + 1;
  else if (diff < 0.5 - eps) r = floor;
  else r = floor % 2 === 0 ? floor : floor + 1;
  return r / m;
}

const fmtScore = (x: number): string => x.toFixed(1); // 파이썬 float str (예 72.0, 84.6)
const fmtInt = (x: number): string => String(pyRound(x, 0)); // :.0f
const fmtPct0 = (rate: number): string => `${pyRound(rate * 100, 0)}%`; // :.0%
const fmtComma = (x: number): string => Math.round(x).toLocaleString("en-US"); // {:,}

// ── 파생값 ──
export function realizedLtv(m: V5MemberInput): number {
  return Math.max(0, pyRound(num(m.membership_revenue) + num(m.pt_revenue) + num(m.other_revenue) - num(m.refund)));
}

export function attendanceRate90d(m: V5MemberInput, s: V5Settings): number {
  const target = num(m.target_visits_per_week, num(s.default_target_visits_per_week, 2));
  const expected = Math.max(1.0, (target * 90.0) / 7.0);
  const visits = num(m.visits_90d);
  return Math.max(0.0, Math.min(2.0, visits / expected));
}

export function tenureMonths(m: V5MemberInput, today: Date): number {
  const start = parseDate(m.first_join_date) ?? parseDate(m.join_date);
  const end = parseDate(m.end_date);
  const effEnd = end && end.getTime() < today.getTime() ? end : today;
  if (!start || effEnd.getTime() < start.getTime()) return num(m.past_membership_months);
  return pyRound(Math.max(0, dayDiff(effEnd, start)) / 30.4 + num(m.past_membership_months), 1);
}

export function dataIssues(m: V5MemberInput): string[] {
  const issues: string[] = [];
  if (!String(m.member_id ?? "").trim()) issues.push("회원ID 누락");
  if (!String(m.member_name ?? "").trim()) issues.push("회원명 누락");
  if (num(m.target_visits_per_week) <= 0) issues.push("목표주횟수 확인 필요");
  const j = parseDate(m.join_date), e = parseDate(m.end_date);
  if (j && e && e.getTime() < j.getTime()) issues.push("종료일이 등록일보다 빠름");
  for (const key of ["membership_revenue", "pt_revenue", "other_revenue", "refund", "gift_cost_365d"] as const) {
    if (num(m[key]) < 0) issues.push(`${key} 음수 확인`);
  }
  return issues;
}

export function baseServiceGate(m: V5MemberInput, s: V5Settings): string {
  if (truthy(m.do_not_contact)) return "전체연락금지";
  if (truthy(m.return_declined)) return "복귀거절";
  const satisfaction = num(m.satisfaction, 0);
  if (truthy(m.complaint) || truthy(m.payment_issue)) return "서비스회복만";
  if (satisfaction && satisfaction < num(s.minimum_satisfaction, 4)) return "서비스회복만";
  return "발송가능";
}

function attendancePoints(rate: number): number {
  if (rate >= 1.0) return 30;
  if (rate >= 0.8) return 27;
  if (rate >= 0.65) return 22;
  if (rate >= 0.5) return 15;
  if (rate > 0) return 8;
  return 0;
}
function tenurePoints(months: number): number {
  if (months >= 24) return 25;
  if (months >= 12) return 20;
  if (months >= 6) return 14;
  if (months >= 3) return 8;
  return 4;
}
function ltvPoints(ltv: number): number {
  // LTV 점수 구간 — 153복싱짐 규모 보정(2026-06-25): 누적결제 대부분 50~150만, 최대 300만
  if (ltv >= 2_500_000) return 25;
  if (ltv >= 1_500_000) return 20;
  if (ltv >= 800_000) return 14;
  if (ltv >= 400_000) return 8;
  return 3;
}
function referralPoints(m: V5MemberInput): number {
  const reg = Math.trunc(num(m.referral_registrations));
  const inq = Math.trunc(num(m.referral_inquiries));
  if (reg >= 3) return 15;
  if (reg === 2) return 12;
  if (reg === 1) return 7;
  if (inq >= 3) return 4;
  return 0;
}
function relationshipPoints(m: V5MemberInput): number {
  const reviews = Math.max(0.0, num(m.reviews));
  const community = Math.max(0.0, Math.min(5.0, num(m.community_contribution)));
  return pyRound(Math.min(5.0, Math.min(2.0, reviews * 0.8) + community * 0.6), 1);
}

export function vipScore(m: V5MemberInput, today: Date, s: V5Settings): { score: number; parts: Record<string, number> } {
  const rate = attendanceRate90d(m, s);
  const months = tenureMonths(m, today);
  const ltv = realizedLtv(m);
  const parts: Record<string, number> = {
    "출석": attendancePoints(rate),
    "장기": tenurePoints(months),
    "매출": ltvPoints(ltv),
    "소개": referralPoints(m),
    "관계": relationshipPoints(m),
  };
  const score = pyRound(Object.values(parts).reduce((a, b) => a + b, 0), 1);
  return { score, parts };
}

export function vipTier(m: V5MemberInput, score: number, gate: string, s: V5Settings): string {
  const manual = String(m.manual_vip_tier ?? "").trim().toUpperCase();
  if (manual === "VIP제외") return "일반";
  if (gate === "서비스회복만") return "VIP보류";
  if (gate === "전체연락금지" || gate === "복귀거절") return "VIP보류";
  const th = s.vip_thresholds ?? DEFAULTS.vip_thresholds;
  let base: string;
  if (["SILVER", "GOLD", "BLACK", "AMBASSADOR"].includes(manual)) base = manual;
  else if (score >= num(th.BLACK, 85)) base = "BLACK";
  else if (score >= num(th.GOLD, 70)) base = "GOLD";
  else if (score >= num(th.SILVER, 55)) base = "SILVER";
  else base = "일반";
  if (
    ["GOLD", "BLACK", "AMBASSADOR"].includes(base) &&
    Math.trunc(num(m.referral_registrations)) >= Math.trunc(num(s.ambassador_min_referrals, 3)) &&
    num(m.satisfaction, 5) >= num(s.minimum_satisfaction, 4)
  ) {
    return "AMBASSADOR";
  }
  return base;
}

export function vipArchetype(m: V5MemberInput, tier: string, rate: number, months: number, ltv: number): string {
  if (tier === "VIP보류") return "서비스회복형";
  const referrals = Math.trunc(num(m.referral_registrations));
  if (tier === "AMBASSADOR") return "앰배서더형";
  const high = [rate >= 0.8, months >= 12, ltv >= 1_500_000, referrals >= 1].filter(Boolean).length;
  if (high >= 3) return "올스타형";
  if (referrals >= 2) return "소개기여형";
  if (ltv >= 3_000_000) return "고가치형";
  if (months >= 24) return "장기동행형";
  if (rate >= 0.9) return "출석충성형";
  if (relationshipPoints(m) >= 4) return "관계기여형";
  return "성장형";
}

export function daysAfterEnd(m: V5MemberInput, today: Date): number | null {
  const end = parseDate(m.end_date);
  if (!end || today.getTime() <= end.getTime()) return null;
  return dayDiff(today, end);
}

export function expirationCohort(daysAfter: number | null, s: V5Settings): string | null {
  if (daysAfter === null) return null;
  const windows = s.winback_windows ?? DEFAULTS.winback_windows;
  for (const [label, bounds] of Object.entries(windows)) {
    if (Math.trunc(bounds[0]) <= daysAfter && daysAfter <= Math.trunc(bounds[1])) return label;
  }
  if (daysAfter < 27) return "1~26일";
  if (daysAfter < 57) return "34~56일";
  if (daysAfter < 87) return "64~86일";
  return "90일+";
}

export function lifecycleStage(m: V5MemberInput, today: Date, s: V5Settings): string {
  const end = parseDate(m.end_date);
  const start = parseDate(m.join_date);
  const gate = baseServiceGate(m, s);
  if (gate === "서비스회복만") return "회복 트랙";
  const after = daysAfterEnd(m, today);
  if (after !== null) return `종료 ${expirationCohort(after, s)}`;
  if (start) {
    const elapsed = dayDiff(today, start);
    if (elapsed <= 30) return "30일 온보딩";
    if (elapsed <= 90) return "습관 고정";
    if (elapsed <= 180) return "성과 성장";
  }
  if (end) {
    const d = dayDiff(end, today);
    if (d >= 0 && d <= 30) return "재등록 설계";
  }
  return "소속감·장기 관계";
}

export function sendGate(m: V5MemberInput, today: Date, desiredType: string, s: V5Settings): string {
  const base = baseServiceGate(m, s);
  if (base !== "발송가능") return base;
  const recontact = parseDate(m.recontact_date);
  if (recontact && today.getTime() < recontact.getTime()) return "재연락일대기";
  const last = parseDate(m.last_post_end_contact_date);
  const minGap = Math.trunc(num(s.minimum_post_end_contact_gap_days, 14));
  if (last && dayDiff(today, last) < minGap) return "쿨다운";
  const contacts = Math.trunc(num(m.post_end_sales_contacts_90d));
  const maxC = Math.trunc(num(s.max_post_end_sales_contacts_90d, 3));
  if (contacts >= maxC) return "영업연락상한";
  if (desiredType === "ad" && (truthy(m.opt_out) || !truthy(m.ad_consent))) return "광고발송보류";
  return "발송가능";
}

export function careDueDate(m: V5MemberInput, tier: string, s: V5Settings): Date | null {
  const last = parseDate(m.last_vip_care_date);
  const cycle = s.care_cycle_days ?? DEFAULTS.care_cycle_days;
  if (!last || !(tier in cycle)) return null;
  const days = Math.trunc(num(cycle[tier]));
  return new Date(last.getTime() + days * 86400000);
}

export function giftRecommendation(
  m: V5MemberInput, tier: string, _archetype: string, gate: string, s: V5Settings, catalog: GiftCatalog,
): GiftRecommendation {
  const caps = s.gift_cap ?? DEFAULTS.gift_cap;
  const cap = Math.trunc(num(caps[tier], 0));
  const used = Math.trunc(num(m.gift_cost_365d));
  const remaining = Math.max(0, cap - used);

  let key: string;
  let reason: string;
  if (gate !== "발송가능" || tier === "일반" || tier === "VIP보류") {
    key = "NONE";
    reason = "서비스/연락 게이트 또는 VIP 기준 미충족";
  } else if (num(m.visits_30d) < num(m.previous_30d_visits) * 0.6) {
    key = "GOAL20";
    reason = "출석 하락: 선물보다 목표·일정 재설계 우선";
  } else {
    const preferred = String(m.preferred_gift_key ?? "").trim().toUpperCase();
    const defaultGift = s.default_gift ?? DEFAULTS.default_gift;
    const defaultKey = defaultGift[tier] ?? "NONE";
    key = preferred in catalog ? preferred : defaultKey;
    reason = `${tier} 정기 감사 케어`;
  }

  const none: GiftItem = catalog.NONE ?? GIFT_CATALOG.NONE;
  let item: GiftItem = catalog[key] ?? none;
  if (!item.active || Math.trunc(num(item.cost)) > remaining) {
    key = "NONE";
    item = none;
    reason = "비활성·예산 초과로 비금전 감사 케어";
  }
  return {
    gift_key: key,
    gift_name: item.name,
    unit_cost: Math.trunc(num(item.cost)),
    valid_days: Math.trunc(num(item.valid_days)),
    annual_cap: cap,
    used_cost_365d: used,
    remaining_budget: remaining,
    reason,
    requires_approval: key !== "NONE",
  };
}

export function winbackScore(m: V5MemberInput, vip: string, score: number, today: Date): number {
  if (truthy(m.do_not_contact) || truthy(m.return_declined)) return 0;
  let result = 0.0;
  if (["SILVER", "GOLD", "BLACK", "AMBASSADOR"].includes(vip)) result += Math.min(30.0, score * 0.3);
  else result += Math.min(15.0, score * 0.15);
  result += Math.min(25.0, ltvPoints(realizedLtv(m)));
  result += Math.min(15.0, tenurePoints(tenureMonths(m, today)) * 0.6);
  result += Math.min(10.0, attendancePoints(attendanceRate90d(m, DEFAULTS)) / 3);
  result += Math.min(10.0, (referralPoints(m) * 2) / 3);
  const interest = String(m.return_interest ?? "미확인").trim();
  result += ({ "높음": 10, "중간": 6, "낮음": 2, "미확인": 3 } as Record<string, number>)[interest] ?? 3;
  const reason = String(m.end_reason ?? "미확인");
  if (reason === "서비스불만" || baseServiceGate(m, DEFAULTS) === "서비스회복만") result -= 25;
  else if (reason === "이사·거리") result -= 15;
  else if (["일정", "일시중단", "목표달성"].includes(reason)) result += 5;
  return pyRound(Math.max(0.0, Math.min(100.0, result)), 1);
}

export function winbackSegment(m: V5MemberInput, tier: string, gate: string): string {
  if (gate === "서비스회복만") return "서비스회복";
  if (["SILVER", "GOLD", "BLACK", "AMBASSADOR"].includes(tier)) return "VIP Alumni";
  const reason = String(m.end_reason ?? "미확인").trim();
  return (
    {
      "일정": "일정맞춤", "비용": "예산맞춤", "컨디션": "회복형", "목표달성": "새목표",
      "이사·거리": "관계종료존중", "서비스불만": "서비스회복", "일시중단": "재연락약속",
    } as Record<string, string>
  )[reason] ?? "이유확인";
}

export function winbackTemplate(cohort: string | null, segment: string, gate: string): [string, string, string] {
  if (gate === "서비스회복만") return ["관리자 서비스 회복", "winback_service_recovery_info", "info"];
  if (gate !== "발송가능") return ["발송 보류", "winback_hold", "none"];
  if (cohort === "30일") {
    if (segment === "VIP Alumni") return ["전화+맞춤 복귀안", "winback_d30_vip_ad", "ad"];
    if (segment === "일정맞춤") return ["문자 후 일정 상담", "winback_d30_schedule_ad", "ad"];
    return ["이유 확인 후 상담", "winback_d30_general_ad", "ad"];
  }
  if (cohort === "60일") {
    if (segment === "예산맞춤") return ["문자 후 응답 상담", "winback_d60_budget_ad", "ad"];
    return ["최소 실행안 제안", "winback_d60_reset_ad", "ad"];
  }
  if (cohort === "90일") {
    if (segment === "VIP Alumni") return ["전화+새 목표 설계", "winback_d90_vip_ad", "ad"];
    return ["관계 재연결", "winback_d90_general_ad", "ad"];
  }
  return ["연락 보류", "winback_outside_window", "none"];
}

export function vipAction(m: V5MemberInput, tier: string, _archetype: string, today: Date, s: V5Settings): [string, string] {
  const gate = baseServiceGate(m, s);
  if (gate === "서비스회복만") return ["서비스 회복 상담", "vip_service_recovery_info"];
  if (tier === "일반" || tier === "VIP보류") return ["관계 유지", "vip_standard_checkin_info"];
  const rate30 = num(m.visits_30d);
  const prev30 = num(m.previous_30d_visits);
  if (prev30 > 0 && rate30 < prev30 * 0.6) return ["출석 하락 확인", "vip_attendance_drop_info"];
  const due = careDueDate(m, tier, s);
  if (due === null || today.getTime() >= due.getTime()) {
    const keys: Record<string, string> = {
      AMBASSADOR: "vip_ambassador_appreciation_info",
      BLACK: "vip_black_appreciation_info",
      GOLD: "vip_gold_checkin_info",
      SILVER: "vip_silver_checkin_info",
    };
    return ["VIP 케어 실행", keys[tier] ?? "vip_standard_checkin_info"];
  }
  return ["관계 유지", `vip_${tier.toLowerCase()}_checkin_info`];
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function analyzeMemberV5(
  member: V5MemberInput,
  opts?: { settings?: V5Settings; giftCatalog?: GiftCatalog },
): V5Result {
  const cfg: Required<V5Settings> = { ...DEFAULTS, ...(opts?.settings ?? {}) };
  const today = parseDate(cfg.today) ?? new Date();
  const catalog = opts?.giftCatalog ?? GIFT_CATALOG;

  const issues = dataIssues(member);
  const rate = attendanceRate90d(member, cfg);
  const months = tenureMonths(member, today);
  const ltv = realizedLtv(member);
  const service = baseServiceGate(member, cfg);
  const { score, parts } = vipScore(member, today, cfg);
  const tier = vipTier(member, score, service, cfg);
  const archetype = vipArchetype(member, tier, rate, months, ltv);

  const after = daysAfterEnd(member, today);
  const cohort = expirationCohort(after, cfg);
  const isExpired = after !== null;
  const wbScore = isExpired ? winbackScore(member, tier, score, today) : 0.0;
  const wbSegment = isExpired ? winbackSegment(member, tier, service) : "";
  const desiredType = isExpired && (cohort === "30일" || cohort === "60일" || cohort === "90일") ? "ad" : "info";
  let gate = sendGate(member, today, desiredType, cfg);

  let action: string;
  let templateKey: string;
  if (isExpired) {
    const [a, tk, actionType] = winbackTemplate(cohort, wbSegment, gate);
    action = a;
    templateKey = tk;
    if (actionType === "ad") {
      gate = sendGate(member, today, "ad", cfg);
      if (gate !== "발송가능") {
        action = "발송 보류";
        templateKey = "winback_hold";
      }
    }
  } else {
    [action, templateKey] = vipAction(member, tier, archetype, today, cfg);
  }

  const gift = giftRecommendation(member, tier, archetype, service, cfg, catalog);
  const due = careDueDate(member, tier, cfg);

  let priority = 0.0;
  const stage = lifecycleStage(member, today, cfg);
  if (service === "서비스회복만") priority += 100;
  if (stage === "30일 온보딩") priority += 25;
  if (cohort === "30일" || cohort === "60일" || cohort === "90일") priority += 35;
  if (tier === "BLACK" || tier === "AMBASSADOR") priority += 20;
  else if (tier === "GOLD" || tier === "SILVER") priority += 10;
  if (isExpired) priority += wbScore * 0.3;
  if (gate !== "발송가능" && gate !== "서비스회복만") priority -= 40;
  priority = pyRound(Math.max(0, Math.min(100, priority)), 1);

  const band = wbScore >= 70 ? "고가능성" : wbScore >= 45 ? "중간" : "낮음";
  const renewal = analyzeRenewalV6(member, today);
  const crmNote =
    `${stage} | VIP ${tier} ${fmtScore(score)}점(${archetype}) | ` +
    `출석률 ${fmtPct0(rate)}, 실현LTV ${fmtComma(ltv)}원 | 종료구간 ${cohort ?? "-"}, ` +
    `복귀 ${fmtInt(wbScore)}점 | 게이트 ${gate} | 다음: ${action}`;

  return {
    member_id: String(member.member_id ?? ""),
    member_name: String(member.member_name ?? ""),
    data_issues: issues,
    lifecycle_stage: stage,
    service_gate: service,
    send_gate: gate,
    attendance_rate_90d: pyRound(rate, 3),
    tenure_months: months,
    realized_ltv: ltv,
    vip_score: score,
    vip_score_parts: parts,
    vip_tier: tier,
    vip_archetype: archetype,
    vip_care_due_date: due ? isoDate(due) : null,
    gift_recommendation: gift,
    days_after_end: after,
    winback_cohort: cohort,
    winback_score: wbScore,
    winback_probability_band: band,
    winback_segment: wbSegment,
    next_action: action,
    template_key: templateKey,
    priority,
    crm_note: crmNote,
    renewal_probability: renewal.renewal_probability,
    renewal_band: renewal.renewal_band,
    expected_ticket: renewal.expected_ticket,
    expected_revenue: renewal.expected_revenue,
    days_to_expiry: renewal.days_to_expiry,
    days_expired: renewal.days_expired,
    renewal_route: renewal.route,
    renewal_rule_id: renewal.rule_id,
    renewal_template_key: renewal.template_key,
    renewal_product_key: renewal.product_key,
    renewal_coupon_key: renewal.coupon_key,
    renewal_gate: renewal.gate,
  };
}

export function analyzeManyV5(
  members: V5MemberInput[],
  opts?: { settings?: V5Settings; giftCatalog?: GiftCatalog },
): V5Result[] {
  const results = members.map((m) => analyzeMemberV5(m, opts));
  return results.sort((a, b) => (b.priority - a.priority) || (a.member_id < b.member_id ? -1 : a.member_id > b.member_id ? 1 : 0));
}

// ============================================================================
// V6 재등록 확률 모델 + 원클릭 라우팅
// 원본: 02_AUTOMATION/153_FC_V6_automation_engine.py (score_member / choose_route)
// 표준라이브러리 로지스틱(logit→sigmoid) 추정확률. 자동발송/자동지급 없음.
// 파이썬 레퍼런스와 1:1 일치 검증(영문/한글 키 모두 ALIASES로 수용).
// ============================================================================

export interface RenewalResult {
  renewal_probability: number;
  renewal_band: string;
  expected_ticket: number;
  expected_revenue: number;
  days_to_expiry: number | null;
  days_expired: number;
  vip_tier_v6: string;
  route: string;
  rule_id: string;
  template_key: string;
  product_key: string;
  coupon_key: string;
  gate: string;
}

export interface V6Settings {
  high_threshold?: number;   // 기본 0.72
  medium_threshold?: number; // 기본 0.45
}

function sigmoid(x: number): number {
  return 1.0 / (1.0 + Math.exp(-Math.max(-30.0, Math.min(30.0, x))));
}

// V6 자체 vip_score(연속형) — 재등록 로짓의 tier 항에 사용. V5 vip_score와 별개.
function vipScoreV6(attendance90: number, tenureM: number, ltv: number, referrals: number, relationship: number): number {
  return (
    Math.min(1.0, attendance90) * 30.0
    + (tenureM >= 24 ? 25 : tenureM >= 12 ? 20 : tenureM >= 6 ? 12 : tenureM >= 3 ? 6 : 0)
    + (ltv >= 3_000_000 ? 25 : ltv >= 1_500_000 ? 20 : ltv >= 750_000 ? 12 : ltv >= 300_000 ? 6 : 0)
    + (referrals >= 3 ? 15 : referrals === 2 ? 10 : referrals === 1 ? 5 : 0)
    + relationship
  );
}

function vipTierV6(vipScore: number, referrals: number, complaint: boolean, paymentIssue: boolean, satisfaction: number): string {
  if (complaint || paymentIssue || (satisfaction > 0 && satisfaction < 4)) return "VIP보류";
  if (vipScore >= 70 && referrals >= 3) return "AMBASSADOR";
  if (vipScore >= 85) return "BLACK";
  if (vipScore >= 70) return "GOLD";
  if (vipScore >= 55) return "SILVER";
  return "일반";
}

export function chooseRenewalRoute(
  probability: number, daysToExpiry: number | null, daysExpired: number, vipTier: string,
  gate: string,
): { route: string; rule_id: string; template_key: string; product_key: string; coupon_key: string } {
  const none = (route: string, rule_id: string, template_key: string, product_key = "NONE", coupon_key = "NONE") =>
    ({ route, rule_id, template_key, product_key, coupon_key });
  if (gate === "서비스회복" || gate === "서비스회복만") return none("서비스회복", "R001", "service_recovery_info");
  const dte = daysToExpiry;
  const de = daysExpired;
  if (dte !== null && dte >= 0 && dte <= 14) {
    if (probability >= 0.72 && ["GOLD", "BLACK", "AMBASSADOR"].includes(vipTier)) {
      const coupon = ["BLACK", "AMBASSADOR"].includes(vipTier) ? "GUEST2" : "GUEST1";
      return none("VIP 원클릭", "R010", "renew_high_vip_coupon_ad", "P12", coupon);
    }
    if (probability >= 0.72) return none("고확률 원클릭", "R011", "renew_high_direct_ad", "P6");
    if (probability >= 0.45) return none("중확률 선택형", "R012", "renew_medium_choice_ad", "P3");
    return none("저확률 정보안내", "R013", "expiry_pre_notice_info");
  }
  if (de >= 1 && de <= 7 && probability >= 0.65) return none("종료직후 원클릭", "R020", "expired_d1_high_ad", "SAME");
  if (de >= 27 && de <= 33) return none("종료30일", "R030", "expired_d30_reset_ad", "P1");
  if (de >= 57 && de <= 63) return none("종료60일", "R040", "expired_d60_restart_ad", "P1");
  if (de >= 87 && de <= 93) return none("종료90일", "R050", "expired_d90_last_ad", "P1");
  return none("", "", "");
}

// V6 게이트 — 재등록 라우팅 전용(원본 gate_member). V5 sendGate와 라벨 호환되게 매핑.
export function renewalGate(m: V5MemberInput, today: Date, s?: V5Settings): string {
  const minSat = num(s?.minimum_satisfaction, 4);
  const minGap = Math.trunc(num(s?.minimum_post_end_contact_gap_days, 3)); // V6 기본 3일
  const maxAd = Math.trunc(num(s?.max_post_end_sales_contacts_90d, 3));
  if (truthy(m.do_not_contact) || truthy(m.opt_out)) return "연락차단";
  if (truthy(m.return_declined)) return "복귀거절";
  const sat = num(m.satisfaction);
  if (truthy(m.complaint) || truthy(m.payment_issue) || (sat > 0 && sat < minSat)) return "서비스회복";
  const recontact = parseDate(m.recontact_date);
  if (recontact && recontact.getTime() > today.getTime()) return "재연락대기";
  const last = parseDate(m.last_post_end_contact_date);
  if (last && dayDiff(today, last) < minGap) return "쿨다운";
  if (Math.trunc(num(m.post_end_sales_contacts_90d)) >= maxAd) return "연락상한";
  return truthy(m.ad_consent) ? "광고발송가능" : "정보성만";
}

export function analyzeRenewalV6(m: V5MemberInput, today: Date, s?: V6Settings): RenewalResult {
  const high = s?.high_threshold ?? 0.72;
  const medium = s?.medium_threshold ?? 0.45;

  const weeklyGoal = Math.max(1.0, num(m.target_visits_per_week, 2));
  const v30 = num(m.visits_30d);
  const vPrev30 = num(m.previous_30d_visits);
  const v90 = num(m.visits_90d);
  const attendance30 = Math.min(1.5, v30 / ((weeklyGoal * 30.0) / 7.0));
  const attendance90 = Math.min(1.5, v90 / ((weeklyGoal * 90.0) / 7.0));
  const trend = vPrev30 === 0 && v30 > 0 ? 1.0 : vPrev30 === 0 ? 0.0 : (v30 - vPrev30) / Math.max(1.0, vPrev30);

  const lastVisit = parseDate(m.last_visit_date);
  const daysSinceVisit = lastVisit === null ? null : Math.max(0, dayDiff(today, lastVisit));
  const nextBooking = parseDate(m.next_booking);
  const hasNextBooking = nextBooking !== null && nextBooking.getTime() >= today.getTime();
  const satisfaction = num(m.satisfaction);

  const firstJoin = parseDate(m.first_join_date) ?? parseDate(m.join_date);
  const end = parseDate(m.end_date);
  const effEnd = end ? (end.getTime() < today.getTime() ? end : today) : today;
  const tenureMonthsV6 = firstJoin === null ? 0.0 : Math.max(0.0, dayDiff(effEnd, firstJoin) / 30.4);

  const paymentCount = Math.trunc(num(m.payment_count));
  const ltv = num(m.membership_revenue) + num(m.pt_revenue) + num(m.other_revenue) - num(m.refund);
  const referrals = Math.trunc(num(m.referral_registrations));
  const relScoreRaw = m.relationship_score !== undefined && m.relationship_score !== null && m.relationship_score !== ""
    ? num(m.relationship_score) : num(m.community_contribution);
  const relationship = Math.min(5.0, relScoreRaw + Math.min(2.0, num(m.reviews)));
  const complaint = truthy(m.complaint);
  const paymentIssue = truthy(m.payment_issue);
  const barrier = String(m.barrier ?? "");
  const exitReason = String(m.end_reason ?? m.exit_reason ?? "");
  const barEx = barrier + exitReason;
  const noShows = Math.trunc(num(m.no_shows_30));

  const vScore = vipScoreV6(attendance90, tenureMonthsV6, ltv, referrals, relationship);
  const tier = vipTierV6(vScore, referrals, complaint, paymentIssue, satisfaction);

  const logit = (
    -1.3
    + 1.5 * Math.min(1.2, attendance30)
    + 1.0 * Math.min(1.2, attendance90)
    + (trend >= 0 ? 0.35 : -0.35)
    + (daysSinceVisit === null ? 0.0
      : daysSinceVisit <= 7 ? 0.8
      : daysSinceVisit <= 14 ? 0.35
      : daysSinceVisit <= 30 ? -0.4
      : -1.0)
    + (hasNextBooking ? 0.65 : 0.0)
    + 0.25 * (satisfaction - 3.0)
    + (tenureMonthsV6 >= 24 ? 0.65 : tenureMonthsV6 >= 12 ? 0.45 : tenureMonthsV6 >= 6 ? 0.25 : 0.0)
    + (paymentCount >= 4 ? 0.55 : paymentCount >= 2 ? 0.3 : 0.0)
    + (ltv >= 3_000_000 ? 0.35 : ltv >= 1_500_000 ? 0.25 : ltv >= 750_000 ? 0.15 : 0.0)
    + (referrals >= 3 ? 0.25 : referrals >= 1 ? 0.1 : 0.0)
    + (tier === "AMBASSADOR" ? 0.4 : tier === "BLACK" ? 0.3 : tier === "GOLD" ? 0.2 : tier === "SILVER" ? 0.1 : 0.0)
    - (complaint ? 1.5 : 0.0)
    - (paymentIssue ? 0.8 : 0.0)
    - (barEx.includes("비용") ? 0.45 : barEx.includes("일정") ? 0.25 : barEx.includes("서비스") ? 1.0 : 0.0)
    - Math.min(0.6, noShows * 0.15)
  );
  const probability = pyRound(sigmoid(logit), 3);
  const expectedTicket = paymentCount > 0 ? pyRound(num(m.membership_revenue) / paymentCount, 0) : 0;
  const daysToExpiry = end === null ? null : dayDiff(end, today);
  const daysExpired = daysToExpiry === null || daysToExpiry >= 0 ? 0 : -daysToExpiry;
  const expectedRevenue = pyRound(probability * expectedTicket, 0);
  const band = probability >= high ? "높음" : probability >= medium ? "중간" : "낮음";

  const gate = renewalGate(m, today);
  const route = chooseRenewalRoute(probability, daysToExpiry, daysExpired, tier, gate);

  return {
    renewal_probability: probability,
    renewal_band: band,
    expected_ticket: expectedTicket,
    expected_revenue: expectedRevenue,
    days_to_expiry: daysToExpiry,
    days_expired: daysExpired,
    vip_tier_v6: tier,
    route: route.route,
    rule_id: route.rule_id,
    template_key: route.template_key,
    product_key: route.product_key,
    coupon_key: route.coupon_key,
    gate,
  };
}

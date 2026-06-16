// ============================================================
// Member Revenue Engine v1 — 순수 함수 (DB 접근 없음)
// 회원 스냅샷 + 연락이력/매출 신호 → 회원별 스코어·생애단계·관리버킷·다음액션·매출기회.
// 금액은 정수(원), 날짜는 KST yyyy-mm-dd 문자열. 모든 점수는 0~100 clamp.
// 자동발송/매출확정 없음 — 산출은 "예상/추천"이며 실행/확정은 상위 레이어에서 사람이 한다.
// ============================================================

// ── 타입 ──
export type MemberLifecycleStage =
  | "onboarding" | "active" | "expiring_soon" | "urgent_renewal"
  | "expired_recent" | "dormant" | "no_visit_risk" | "pt_low" | "vip" | "unknown";

export type MemberCareBucket =
  | "renewal_today" | "checkin_today" | "pt_upsell" | "onboarding_care"
  | "winback" | "vip_referral" | "normal" | "needs_data";

export type ContactPriority = "urgent" | "high" | "normal" | "low";

export type OpportunityType =
  | "renewal" | "pt_upsell" | "winback" | "referral" | "product_upgrade" | "goods" | "dan";

/** member_snapshots 한 행(필요 컬럼만) */
export interface RawSnapshot {
  id: string;
  member_name: string;
  phone: string | null;
  normalized_phone: string | null;
  product_name: string | null;
  membership_type: string | null;
  start_date: string | null;
  end_date: string | null;
  total_sessions: number | null;
  used_sessions: number | null;
  remaining_sessions: number | null;
  latest_visit_date: string | null;
  payment_amount: number | null;
  status: string | null;
}

/** 엔진 입력(정규화된 회원) */
export interface CareMemberInput {
  snapshot_id: string | null;
  member_name: string;
  phone: string | null;
  normalized_phone: string; // 숫자만, 전화 없으면 ""
  product_name: string | null;
  membership_type: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  remaining_sessions: number | null;
  latest_visit_date: string | null;
  payment_amount: number | null;
}

/** 지점 단위 컨텍스트(연락/구매 신호) */
export interface CareContext {
  today: string;                  // KST yyyy-mm-dd
  branchAvgPayment: number;       // 지점 평균 결제금액(예상매출 폴백)
  recentSuccessPhones: Set<string>;   // 최근 14일 성공 연락 있은 normalized_phone
  recentPurchasePhones: Set<string>;  // 최근 7일 재등록/구매 normalized_phone
  dueFollowupPhones: Set<string>;     // 성공 연락 후 next_action_date <= 오늘
}

export interface CareScores {
  churn_risk_score: number;
  health_score: number;
  revenue_opportunity_score: number;
}

export interface OpportunityDraft {
  opportunity_type: OpportunityType;
  title: string;
  expected_amount: number;
  probability: number;
  priority: ContactPriority;
  due_date: string | null;
  reason: string;
  recommended_script_key: string | null;
  generated_key: string;
}

export interface CareProfileDraft {
  normalized_phone: string;
  phone: string | null;
  member_snapshot_id: string | null;
  member_name: string;
  product_name: string | null;
  membership_type: string | null;
  lifecycle_stage: MemberLifecycleStage;
  care_bucket: MemberCareBucket;
  health_score: number;
  churn_risk_score: number;
  revenue_opportunity_score: number;
  ltv_amount: number;
  expected_revenue_amount: number;
  days_until_expiry: number | null;
  days_since_last_visit: number | null;
  remaining_sessions: number | null;
  next_best_action: string;
  next_best_offer: string | null;
  contact_priority: ContactPriority;
  next_contact_due_date: string | null;
  reasons: string[];
  metadata: Record<string, unknown>;
}

export interface BuiltMemberCare {
  profile: CareProfileDraft;
  opportunities: OpportunityDraft[];
}

// ── 날짜/숫자 유틸 ──
export function kstTodayStr(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a.slice(0, 10)}T00:00:00Z`) - Date.parse(`${b.slice(0, 10)}T00:00:00Z`)) / 86400000);
}
function addDaysStr(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}
function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
function toIntOrNull(v: number | null | undefined): number | null {
  return v == null || Number.isNaN(v) ? null : Math.round(v);
}

/** member_snapshots.normalized_phone 과 동일 규칙(숫자만) */
export function normalizePhone(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[^0-9]/g, "");
}

const DORMANT_STATUS = ["휴면", "정지", "중지", "만료", "expired", "dormant", "paused", "suspended", "withdrawn", "탈퇴"];
function isDormantStatus(status: string | null): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return DORMANT_STATUS.some((t) => s.includes(t.toLowerCase()));
}

interface Metrics {
  dToEnd: number | null;      // 만료까지 일수(양수=남음, 음수=지남)
  pastExpiry: number | null;  // 만료 후 경과 일수(양수)
  daysSinceVisit: number | null;
  daysSinceStart: number | null;
  remaining: number | null;
}
function metricsOf(m: CareMemberInput, today: string): Metrics {
  const dToEnd = m.end_date ? dayDiff(m.end_date, today) : null;
  const pastExpiry = dToEnd != null && dToEnd < 0 ? -dToEnd : null;
  const daysSinceVisit = m.latest_visit_date ? dayDiff(today, m.latest_visit_date) : null;
  const daysSinceStart = m.start_date ? dayDiff(today, m.start_date) : null;
  return { dToEnd, pastExpiry, daysSinceVisit, daysSinceStart, remaining: m.remaining_sessions };
}
function isVip(m: CareMemberInput, ctx: CareContext): boolean {
  if (m.payment_amount == null || m.payment_amount <= 0) return false;
  const threshold = Math.max(500000, ctx.branchAvgPayment * 2);
  return m.payment_amount >= threshold;
}

// ── 1. 정규화 ──
export function normalizeMemberForCare(s: RawSnapshot): CareMemberInput {
  const np = (s.normalized_phone && s.normalized_phone.length > 0) ? s.normalized_phone : normalizePhone(s.phone);
  return {
    snapshot_id: s.id,
    member_name: s.member_name,
    phone: s.phone,
    normalized_phone: np,
    product_name: s.product_name,
    membership_type: s.membership_type,
    status: s.status,
    start_date: s.start_date,
    end_date: s.end_date,
    remaining_sessions: toIntOrNull(s.remaining_sessions),
    latest_visit_date: s.latest_visit_date,
    payment_amount: toIntOrNull(s.payment_amount),
  };
}

// ── 2. 스코어 (+근거) ──
interface ScoreWithReasons { scores: CareScores; reasons: string[] }
function scoreInternal(m: CareMemberInput, ctx: CareContext, mt: Metrics): ScoreWithReasons {
  const reasons: string[] = [];
  const np = m.normalized_phone;

  // churn_risk
  let churn = 0;
  if (mt.dToEnd != null) {
    if (mt.dToEnd >= 0 && mt.dToEnd <= 7) { churn += 35; reasons.push(`만료 D-${mt.dToEnd}`); }
    else if (mt.dToEnd >= 0 && mt.dToEnd <= 14) { churn += 20; reasons.push(`만료 D-${mt.dToEnd}`); }
    else if (mt.pastExpiry != null) {
      if (mt.pastExpiry <= 30) { churn += 35; reasons.push(`만료 후 ${mt.pastExpiry}일`); }
      else { churn += 45; reasons.push(`만료 후 ${mt.pastExpiry}일(장기)`); }
    }
  }
  if (mt.daysSinceVisit != null) {
    if (mt.daysSinceVisit >= 30) { churn += 45; reasons.push(`${mt.daysSinceVisit}일 미방문`); }
    else if (mt.daysSinceVisit >= 21) { churn += 35; reasons.push(`${mt.daysSinceVisit}일 미방문`); }
    else if (mt.daysSinceVisit >= 14) { churn += 20; reasons.push(`${mt.daysSinceVisit}일 미방문`); }
    else if (mt.daysSinceVisit >= 7) { churn += 10; reasons.push(`${mt.daysSinceVisit}일 미방문`); }
  }
  if (mt.remaining != null) {
    if (mt.remaining <= 0) { churn += 25; reasons.push("잔여 0회"); }
    else if (mt.remaining <= 2) { churn += 15; reasons.push(`잔여 ${mt.remaining}회`); }
  }
  if (np && ctx.recentSuccessPhones.has(np)) { churn -= 15; reasons.push("최근 성공 연락(위험↓)"); }
  if (np && ctx.recentPurchasePhones.has(np)) { churn -= 30; reasons.push("최근 재등록/구매(위험↓)"); }
  if (isDormantStatus(m.status)) { churn += 20; reasons.push("상태: 휴면/정지 계열"); }
  const churn_risk_score = clampScore(churn);

  // health
  let health = 100 - churn_risk_score;
  if (mt.daysSinceStart != null && mt.daysSinceStart <= 14 && m.latest_visit_date) health += 10;
  if (isVip(m, ctx)) health += 5;
  const health_score = clampScore(health);

  // revenue_opportunity
  let rev = 0;
  if (mt.dToEnd != null) {
    if (mt.dToEnd >= 0 && mt.dToEnd <= 7) rev += 50;
    else if (mt.dToEnd >= 0 && mt.dToEnd <= 14) rev += 35;
    else if (mt.pastExpiry != null && mt.pastExpiry <= 30) rev += 40;
  }
  if (mt.daysSinceVisit != null && mt.daysSinceVisit >= 14 && mt.dToEnd != null && mt.dToEnd >= 0) rev += 25;
  if (mt.remaining != null && mt.remaining <= 2) rev += 40;
  if (isVip(m, ctx)) rev += 20;
  if (np && ctx.dueFollowupPhones.has(np)) rev += 15;
  const revenue_opportunity_score = clampScore(rev);

  return { scores: { churn_risk_score, health_score, revenue_opportunity_score }, reasons };
}
export function scoreMemberCare(m: CareMemberInput, ctx: CareContext): CareScores {
  return scoreInternal(m, ctx, metricsOf(m, ctx.today)).scores;
}

// ── 3. 생애단계 ──
export function classifyLifecycleStage(m: CareMemberInput, ctx: CareContext): MemberLifecycleStage {
  const mt = metricsOf(m, ctx.today);
  const noData = m.end_date == null && m.latest_visit_date == null && m.start_date == null && m.remaining_sessions == null;
  if (noData) return "unknown";
  if (mt.pastExpiry != null) return mt.pastExpiry > 30 ? "dormant" : "expired_recent";
  if (mt.dToEnd != null && mt.dToEnd >= 0 && mt.dToEnd <= 7) return "urgent_renewal";
  if (mt.dToEnd != null && mt.dToEnd >= 0 && mt.dToEnd <= 14) return "expiring_soon";
  if (mt.remaining != null && mt.remaining <= 2) return "pt_low";
  if (mt.daysSinceVisit != null && mt.daysSinceVisit >= 30) return "dormant";
  if (mt.daysSinceVisit != null && mt.daysSinceVisit >= 7) return "no_visit_risk";
  if (mt.daysSinceStart != null && mt.daysSinceStart <= 14) return "onboarding";
  if (isVip(m, ctx)) return "vip";
  return "active";
}

// ── 4. 관리 버킷 ──
const STAGE_BUCKET: Record<MemberLifecycleStage, MemberCareBucket> = {
  urgent_renewal: "renewal_today",
  expiring_soon: "renewal_today",
  expired_recent: "winback",
  dormant: "winback",
  no_visit_risk: "checkin_today",
  pt_low: "pt_upsell",
  onboarding: "onboarding_care",
  vip: "vip_referral",
  active: "normal",
  unknown: "needs_data",
};
export function deriveCareBucket(m: CareMemberInput, stage: MemberLifecycleStage): MemberCareBucket {
  if (!m.normalized_phone) return "needs_data";
  return STAGE_BUCKET[stage];
}

// ── 5. 다음 최적 액션 + 추천 문구키 + 오퍼 ──
const STAGE_ACTION: Record<MemberLifecycleStage, string> = {
  urgent_renewal: "오늘 재등록 의사 확인",
  expiring_soon: "만료 전 재등록 안내",
  expired_recent: "복귀 혜택 안내",
  dormant: "휴면 복귀 제안",
  no_visit_risk: "안부 연락 후 방문 예약",
  pt_low: "PT/회차권 연장 상담",
  onboarding: "신규 정착 체크",
  vip: "소개/리뷰 요청",
  active: "정상 관리 유지",
  unknown: "회원정보 확인",
};
const STAGE_OFFER: Record<MemberLifecycleStage, string | null> = {
  urgent_renewal: "이번 주 방문 시 이어서 재등록",
  expiring_soon: "만료 전 재등록 안내",
  expired_recent: "복귀 혜택",
  dormant: "부담 없는 복귀 안내",
  no_visit_risk: "방문 예약 도움",
  pt_low: "다음 회차/PT 연장",
  onboarding: "정착 코칭",
  vip: "소개/리뷰 요청",
  active: null,
  unknown: null,
};
export function chooseNextBestAction(m: CareMemberInput, ctx: CareContext): { action: string; offer: string | null; scriptKey: string | null } {
  const mt = metricsOf(m, ctx.today);
  const stage = classifyLifecycleStage(m, ctx);
  if (!m.normalized_phone) return { action: "연락처 등 회원정보 확인", offer: null, scriptKey: null };
  let scriptKey: string | null = null;
  switch (stage) {
    case "urgent_renewal": scriptKey = "renewal_d7"; break;
    case "expiring_soon": scriptKey = "renewal_d14"; break;
    case "expired_recent": scriptKey = "renewal_expired_d1"; break;
    case "dormant": scriptKey = (mt.pastExpiry != null && mt.pastExpiry > 60) ? "dormant_d60" : "dormant_d30"; break;
    case "no_visit_risk":
      scriptKey = mt.daysSinceVisit != null && mt.daysSinceVisit >= 21 ? "no_visit_d21"
        : mt.daysSinceVisit != null && mt.daysSinceVisit >= 14 ? "no_visit_d14" : "no_visit_d7";
      break;
    case "pt_low": scriptKey = "pt_low_2"; break;
    case "onboarding": scriptKey = mt.daysSinceStart != null && mt.daysSinceStart >= 7 ? "onboarding_d7" : "onboarding_d3"; break;
    case "vip": scriptKey = "vip_referral"; break;
    default: scriptKey = null;
  }
  return { action: STAGE_ACTION[stage], offer: STAGE_OFFER[stage], scriptKey };
}

// ── 6. 예상 매출/LTV ──
export function estimateRevenueOpportunity(m: CareMemberInput, ctx: CareContext): { expected_revenue_amount: number; ltv_amount: number } {
  const hasOwn = m.payment_amount != null && m.payment_amount > 0;
  const base = hasOwn ? (m.payment_amount as number) : (ctx.branchAvgPayment > 0 ? ctx.branchAvgPayment : 0);
  // 허위 매출 금지: 자체 결제근거 없으면 지점 평균(또는 0)만 "예상"으로 사용
  const expected = Math.max(0, Math.round(base));
  const ltv = hasOwn ? Math.round(m.payment_amount as number) : expected; // payment_amount(누적결제)를 LTV 프록시로
  return { expected_revenue_amount: expected, ltv_amount: ltv };
}

// ── 우선순위 / 연락 예정일 ──
const PRIORITY_ORDER: Record<ContactPriority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };
// 생애단계 우선순위 하한: 재등록 임박·회차 임박은 점수와 무관하게 최소 high.
const STAGE_PRIORITY_FLOOR: Partial<Record<MemberLifecycleStage, ContactPriority>> = {
  urgent_renewal: "high", pt_low: "high",
};
function contactPriorityOf(scores: CareScores, stage: MemberLifecycleStage): ContactPriority {
  let p: ContactPriority;
  if (scores.revenue_opportunity_score >= 80 || scores.churn_risk_score >= 80) p = "urgent";
  else if (scores.revenue_opportunity_score >= 60 || scores.churn_risk_score >= 60) p = "high";
  else if (stage === "active" || stage === "unknown") p = "low";
  else p = "normal";
  const floor = STAGE_PRIORITY_FLOOR[stage];
  if (floor && PRIORITY_ORDER[floor] > PRIORITY_ORDER[p]) return floor;
  return p;
}
function dueDateOf(priority: ContactPriority, today: string): string {
  if (priority === "urgent") return today;
  if (priority === "high") return addDaysStr(today, 1);
  if (priority === "normal") return addDaysStr(today, 3);
  return addDaysStr(today, 14);
}

// ── 7. 매출 기회 생성 ──
const OPP_PROB: Record<string, number> = {
  "renewal:urgent_renewal": 65, "renewal:expiring_soon": 55, "renewal:expired_recent": 35,
  "pt_upsell": 50, "winback": 25, "referral": 40,
};
export function generateMemberOpportunities(m: CareMemberInput, ctx: CareContext): OpportunityDraft[] {
  if (!m.normalized_phone) return []; // 연락 불가 → 기회 생성 안 함
  const mt = metricsOf(m, ctx.today);
  const { scores } = scoreInternal(m, ctx, mt);
  const stage = classifyLifecycleStage(m, ctx);
  const nba = chooseNextBestAction(m, ctx);
  const { expected_revenue_amount } = estimateRevenueOpportunity(m, ctx);
  const priority = contactPriorityOf(scores, stage);
  const due = dueDateOf(priority, ctx.today);
  const np = m.normalized_phone;
  const out: OpportunityDraft[] = [];

  const pushRenewal = (kind: "urgent_renewal" | "expiring_soon" | "expired_recent") => {
    out.push({
      opportunity_type: "renewal",
      title: kind === "expired_recent" ? `복귀·재등록: ${m.member_name}` : `재등록: ${m.member_name}`,
      expected_amount: expected_revenue_amount,
      probability: OPP_PROB[`renewal:${kind}`] ?? 50,
      priority, due_date: due,
      reason: mt.dToEnd != null ? (mt.dToEnd >= 0 ? `만료 D-${mt.dToEnd}` : `만료 후 ${mt.pastExpiry}일`) : "재등록 대상",
      recommended_script_key: nba.scriptKey,
      generated_key: `renewal:${np}`,
    });
  };

  if (stage === "urgent_renewal" || stage === "expiring_soon" || stage === "expired_recent") pushRenewal(stage);
  else if (stage === "dormant") {
    out.push({
      opportunity_type: "winback", title: `휴면 복귀: ${m.member_name}`,
      expected_amount: expected_revenue_amount, probability: OPP_PROB["winback"] ?? 25, priority, due_date: due,
      reason: mt.pastExpiry != null ? `만료 후 ${mt.pastExpiry}일` : (mt.daysSinceVisit != null ? `${mt.daysSinceVisit}일 미방문` : "휴면"),
      recommended_script_key: nba.scriptKey, generated_key: `winback:${np}`,
    });
  } else if (stage === "vip") {
    out.push({
      opportunity_type: "referral", title: `소개/리뷰 요청: ${m.member_name}`,
      expected_amount: expected_revenue_amount, probability: OPP_PROB["referral"] ?? 40, priority: priority === "low" ? "normal" : priority, due_date: due,
      reason: "고결제·고참여 회원", recommended_script_key: "vip_referral", generated_key: `referral:${np}`,
    });
  }

  // PT 잔여 부족은 별도 업셀 기회(재등록 대상이어도 추가)
  if (mt.remaining != null && mt.remaining <= 2) {
    out.push({
      opportunity_type: "pt_upsell", title: `PT/회차 연장: ${m.member_name} (잔여 ${mt.remaining}회)`,
      expected_amount: expected_revenue_amount, probability: OPP_PROB["pt_upsell"] ?? 50,
      priority: priority === "low" ? "normal" : priority, due_date: due,
      reason: `잔여 ${mt.remaining}회`, recommended_script_key: "pt_low_2", generated_key: `pt_upsell:${np}`,
    });
  }
  return out;
}

// ── 8. 회원 케어 프로필 빌드(전체 조립) ──
export function buildMemberCareProfile(m: CareMemberInput, ctx: CareContext): BuiltMemberCare {
  const mt = metricsOf(m, ctx.today);
  const { scores, reasons } = scoreInternal(m, ctx, mt);
  const stage = classifyLifecycleStage(m, ctx);
  const bucket = deriveCareBucket(m, stage);
  const nba = chooseNextBestAction(m, ctx);
  const { expected_revenue_amount, ltv_amount } = estimateRevenueOpportunity(m, ctx);
  const hasPhone = !!m.normalized_phone;
  const priority: ContactPriority = hasPhone ? contactPriorityOf(scores, stage) : "normal";
  const profileNp = hasPhone ? m.normalized_phone : `noinfo:${m.snapshot_id ?? m.member_name}`;
  const nextDue = hasPhone ? dueDateOf(priority, ctx.today) : null;

  const profile: CareProfileDraft = {
    normalized_phone: profileNp,
    phone: m.phone,
    member_snapshot_id: m.snapshot_id,
    member_name: m.member_name,
    product_name: m.product_name,
    membership_type: m.membership_type,
    lifecycle_stage: stage,
    care_bucket: bucket,
    health_score: scores.health_score,
    churn_risk_score: scores.churn_risk_score,
    revenue_opportunity_score: scores.revenue_opportunity_score,
    ltv_amount,
    expected_revenue_amount,
    days_until_expiry: mt.dToEnd,
    days_since_last_visit: mt.daysSinceVisit,
    remaining_sessions: mt.remaining,
    next_best_action: hasPhone ? nba.action : "연락처 등 회원정보 확인",
    next_best_offer: hasPhone ? nba.offer : null,
    contact_priority: priority,
    next_contact_due_date: nextDue,
    reasons,
    metadata: { has_phone: hasPhone, script_key: hasPhone ? nba.scriptKey : null },
  };
  const opportunities = generateMemberOpportunities(m, ctx);
  return { profile, opportunities };
}

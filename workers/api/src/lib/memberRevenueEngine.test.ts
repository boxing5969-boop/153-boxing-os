// Member Revenue Engine — 순수 함수 테스트 (의존성 없는 러너; `bun run`/node 로 실행 가능)
// 실행: bun workers/api/src/lib/memberRevenueEngine.test.ts  →  runMemberRevenueEngineTests()
import {
  normalizeMemberForCare, buildMemberCareProfile, generateMemberOpportunities, scoreMemberCare,
  type RawSnapshot, type CareContext,
} from "./memberRevenueEngine";

function assert(cond: boolean, msg: string): void { if (!cond) throw new Error(`FAIL: ${msg}`); }

const TODAY = "2026-06-17";
function addD(n: number): string { return new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10); }
function ctx(over: Partial<CareContext> = {}): CareContext {
  return { today: TODAY, branchAvgPayment: 200000, recentSuccessPhones: new Set(), recentPurchasePhones: new Set(), dueFollowupPhones: new Set(), ...over };
}
function raw(o: Partial<RawSnapshot> & { phone?: string | null }): RawSnapshot {
  return {
    id: o.id ?? "s1", member_name: o.member_name ?? "테스트", phone: o.phone === undefined ? "010-1234-5678" : o.phone,
    normalized_phone: null, product_name: o.product_name ?? null, membership_type: o.membership_type ?? null,
    start_date: o.start_date ?? null, end_date: o.end_date ?? null, total_sessions: null, used_sessions: null,
    remaining_sessions: o.remaining_sessions ?? null, latest_visit_date: o.latest_visit_date ?? null,
    payment_amount: o.payment_amount === undefined ? 120000 : o.payment_amount, status: o.status ?? null,
  };
}
const build = (o: Partial<RawSnapshot> & { phone?: string | null }, c: Partial<CareContext> = {}) => buildMemberCareProfile(normalizeMemberForCare(raw(o)), ctx(c));

export function runMemberRevenueEngineTests(): { pass: number } {
  let pass = 0;
  // 1) 만료 D-7 → urgent_renewal, high+, renewal opp
  let r = build({ end_date: addD(7) });
  assert(r.profile.lifecycle_stage === "urgent_renewal", "1 urgent_renewal"); pass++;
  assert(r.profile.contact_priority === "urgent" || r.profile.contact_priority === "high", "1 priority"); pass++;
  assert(r.opportunities.some((o) => o.opportunity_type === "renewal"), "1 renewal opp"); pass++;
  // 2) 14일 미방문(유효) → no_visit_risk
  r = build({ latest_visit_date: addD(-14) });
  assert(r.profile.lifecycle_stage === "no_visit_risk", "2 no_visit_risk"); pass++;
  // 3) PT 잔여 2 → pt_low + pt_upsell opp
  r = build({ remaining_sessions: 2 });
  assert(r.profile.lifecycle_stage === "pt_low", "3 pt_low"); pass++;
  assert(r.opportunities.some((o) => o.opportunity_type === "pt_upsell"), "3 pt_upsell opp"); pass++;
  // 4) 만료 후 45일 → dormant + winback
  r = build({ end_date: addD(-45) });
  assert(r.profile.lifecycle_stage === "dormant", "4 dormant"); pass++;
  assert(r.opportunities.some((o) => o.opportunity_type === "winback"), "4 winback opp"); pass++;
  // 5) 최근 재등록 성공 → churn 하락
  const without = scoreMemberCare(normalizeMemberForCare(raw({ end_date: addD(-10) })), ctx());
  const withBuy = scoreMemberCare(normalizeMemberForCare(raw({ end_date: addD(-10) })), ctx({ recentPurchasePhones: new Set(["01012345678"]) }));
  assert(withBuy.churn_risk_score < without.churn_risk_score, "5 churn drops"); pass++;
  // 6) idempotent generated_key
  const a = generateMemberOpportunities(normalizeMemberForCare(raw({ end_date: addD(7) })), ctx());
  const b = generateMemberOpportunities(normalizeMemberForCare(raw({ end_date: addD(7) })), ctx());
  assert(!!a[0] && !!b[0] && a[0].generated_key === b[0].generated_key, "6 stable key"); pass++;
  // 8) 전화 없음 → needs_data, opp 0
  r = build({ phone: null, end_date: addD(7) });
  assert(r.profile.care_bucket === "needs_data", "8 needs_data"); pass++;
  assert(r.opportunities.length === 0, "8 no opp"); pass++;
  // 9) payment 없음 & branchAvg 0 → expected 0
  r = build({ payment_amount: null, end_date: addD(7) }, { branchAvgPayment: 0 });
  assert(r.profile.expected_revenue_amount === 0, "9 no exaggeration"); pass++;
  // 10) KST D-day
  r = build({ end_date: addD(5) });
  assert(r.profile.days_until_expiry === 5, "10 d-day"); pass++;
  return { pass };
}

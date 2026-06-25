// fcV5Engine 단위 테스트 — 의존성 없는 러너 (bun/node 로 실행 가능)
// 원본: 04_ENGINE/test_fc_lifecycle_vip_winback_engine.py (11 케이스) 1:1 포팅
// 실행: bun workers/api/src/lib/fcV5Engine.test.ts  →  runFcV5EngineTests()
import { analyzeMemberV5, type V5MemberInput } from "./fcV5Engine";

function assert(cond: boolean, msg: string): void { if (!cond) throw new Error(`FAIL: ${msg}`); }
const SETTINGS = { today: "2026-06-24" };
const run = (m: V5MemberInput) => analyzeMemberV5(m, { settings: SETTINGS });

export function runFcV5EngineTests(): { pass: number } {
  let pass = 0;

  // 1) 앰배서더 + GUEST2 추천
  let r = run({
    member_id: "A", member_name: "A", first_join_date: "2023-01-01", join_date: "2026-01-01", end_date: "2027-01-01",
    target_visits_per_week: 2, visits_90d: 28, satisfaction: 5, membership_revenue: 1800000, pt_revenue: 600000,
    referral_registrations: 3, reviews: 3, community_contribution: 5,
  });
  assert(r.vip_tier === "AMBASSADOR", "1 ambassador tier");
  assert(r.gift_recommendation.gift_key === "GUEST2", "1 ambassador gift GUEST2"); pass++;

  // 2) 고액결제 + 민원 → VIP보류 · 서비스 회복 · 기프트 NONE
  r = run({
    member_id: "B", member_name: "B", first_join_date: "2024-01-01", join_date: "2026-01-01", end_date: "2027-01-01",
    target_visits_per_week: 3, visits_90d: 35, satisfaction: 3, complaint: true, membership_revenue: 5000000,
  });
  assert(r.vip_tier === "VIP보류", "2 hold tier");
  assert(r.next_action === "서비스 회복 상담", "2 service recovery action");
  assert(r.gift_recommendation.gift_key === "NONE", "2 gift NONE"); pass++;

  // 3) 종료 D30 · 일정맞춤 · 발송가능 · winback_d30_schedule_ad
  r = run({
    member_id: "C", member_name: "C", first_join_date: "2025-05-26", join_date: "2025-05-26", end_date: "2026-05-25",
    target_visits_per_week: 2, visits_90d: 20, satisfaction: 5, ad_consent: true, end_reason: "일정", return_interest: "높음",
  });
  assert(r.winback_cohort === "30일", "3 cohort 30");
  assert(r.winback_segment === "일정맞춤", "3 segment 일정맞춤");
  assert(r.send_gate === "발송가능", "3 send gate ok");
  assert(r.template_key === "winback_d30_schedule_ad", "3 template"); pass++;

  // 4) 종료 D60 · 비용 → winback_d60_budget_ad
  r = run({
    member_id: "D", member_name: "D", first_join_date: "2025-10-26", join_date: "2025-10-26", end_date: "2026-04-25",
    target_visits_per_week: 2, visits_90d: 15, satisfaction: 4, ad_consent: true, end_reason: "비용", return_interest: "중간",
  });
  assert(r.winback_cohort === "60일", "4 cohort 60");
  assert(r.template_key === "winback_d60_budget_ad", "4 template"); pass++;

  // 5) 종료 D90 · 광고동의 없음 → 광고발송보류 · 발송 보류
  r = run({
    member_id: "E", member_name: "E", first_join_date: "2025-09-27", join_date: "2025-09-27", end_date: "2026-03-26",
    target_visits_per_week: 2, visits_90d: 10, satisfaction: 4, ad_consent: false, end_reason: "미확인",
  });
  assert(r.winback_cohort === "90일", "5 cohort 90");
  assert(r.send_gate === "광고발송보류", "5 ad hold");
  assert(r.next_action === "발송 보류", "5 action hold"); pass++;

  // 6) 종료 후 서비스불만 → 서비스회복만 · winback_service_recovery_info
  r = run({
    member_id: "F", member_name: "F", join_date: "2025-11-26", end_date: "2026-05-25",
    target_visits_per_week: 2, visits_90d: 12, satisfaction: 2, complaint: true, ad_consent: true, end_reason: "서비스불만",
  });
  assert(r.send_gate === "서비스회복만", "6 recovery gate");
  assert(r.template_key === "winback_service_recovery_info", "6 template"); pass++;

  // 7) 전체연락금지 → 발송 보류
  r = run({
    member_id: "G", member_name: "G", join_date: "2025-03-26", end_date: "2026-03-26",
    target_visits_per_week: 2, visits_90d: 20, ad_consent: true, do_not_contact: true,
  });
  assert(r.send_gate === "전체연락금지", "7 dnc gate");
  assert(r.next_action === "발송 보류", "7 action hold"); pass++;

  // 8) 기프트 연간한도 초과 → NONE
  r = run({
    member_id: "H", member_name: "H", first_join_date: "2024-01-01", join_date: "2026-01-01", end_date: "2027-01-01",
    target_visits_per_week: 2, visits_90d: 28, satisfaction: 5, membership_revenue: 1700000, referral_registrations: 1,
    gift_cost_365d: 60000, preferred_gift_key: "GUEST2",
  });
  assert(r.vip_tier === "GOLD" || r.vip_tier === "BLACK", "8 tier gold/black");
  assert(r.gift_recommendation.gift_key === "NONE", "8 gift cap NONE"); pass++;

  // 9) 출석 하락 → 선물 대신 목표상담(GOAL20) · vip_attendance_drop_info
  r = run({
    member_id: "I", member_name: "I", first_join_date: "2024-01-01", join_date: "2026-01-01", end_date: "2027-01-01",
    target_visits_per_week: 2, visits_90d: 25, visits_30d: 2, previous_30d_visits: 8, satisfaction: 5, membership_revenue: 1700000,
  });
  assert(r.gift_recommendation.gift_key === "GOAL20", "9 gift GOAL20");
  assert(r.template_key === "vip_attendance_drop_info", "9 template"); pass++;

  // 10) 복귀거절 → 복귀거절 게이트 · 복귀점수 0
  r = run({
    member_id: "J", member_name: "J", join_date: "2025-01-01", end_date: "2026-05-25",
    target_visits_per_week: 2, visits_90d: 20, satisfaction: 5, ad_consent: true, return_declined: true,
  });
  assert(r.send_gate === "복귀거절", "10 decline gate");
  assert(r.winback_score === 0, "10 winback 0"); pass++;

  // 11) 영업연락 상한(90일 3회) → 영업연락상한
  r = run({
    member_id: "K", member_name: "K", join_date: "2025-01-01", end_date: "2026-04-25",
    target_visits_per_week: 2, visits_90d: 20, satisfaction: 5, ad_consent: true, post_end_sales_contacts_90d: 3,
  });
  assert(r.send_gate === "영업연락상한", "11 contact cap"); pass++;

  return { pass };
}

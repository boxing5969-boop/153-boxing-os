/**
 * KPI 대시보드 서비스 — 4차
 * - get_hq_kpi_dashboard()        : 본사용 10개 KPI
 * - get_branch_ops_dashboard(id)  : 지점장용 7개 KPI
 * 두 RPC 모두 SECURITY DEFINER + 권한검증 내장 → RPC가 접근통제 역할.
 */
import { supabase } from "@/integrations/supabase/client";

// ── 본사 KPI ──────────────────────────────────────────────────
export interface HqBranchKpi {
  branch_id: string;
  branch_name: string;
  revenue_month: number;   // 이번달 시작 이용권 가격 합
  active_members: number;  // status=active
  new_members: number;     // 이번달 신규 등록
  expiring_soon: number;   // 30일 내 만료
  unpaid_members: number;  // status=unpaid
  inactive_14d: number;    // 최근 14일 미출석
}

export interface StaffProcessing {
  profile_id: string;
  name: string;
  total: number;
  done: number;
  rate: number;            // 완료율 %
}

export interface HqKpiDashboard {
  period: { month_start: string; month_end: string };
  branches: HqBranchKpi[];
  renewal_rate: number;             // %
  satisfaction_avg: number | null;  // 5점 만점
  complaint_count: number;
  staff_processing: StaffProcessing[];
}

// ── 지점 운영 KPI ─────────────────────────────────────────────
export interface BranchOpsDashboard {
  branch_id: string;
  base_date: string;
  today_attendance: number;
  new_consultations_today: number;
  renewal_targets: number;
  unpaid_targets: number;
  tasks_due: number;
  low_satisfaction: number;
  long_inactive: number;
}

/** 본사 KPI 대시보드 (super_admin / hq_admin 전용) */
export async function getHqKpiDashboard(): Promise<HqKpiDashboard> {
  const { data, error } = await supabase.rpc(
    "get_hq_kpi_dashboard" as "get_survey_results_summary",
    {} as unknown as { p_survey_template_id: string }
  );
  if (error) throw new Error(error.message);
  const r = data as unknown as { success: boolean; error?: string } & HqKpiDashboard;
  if (!r.success) throw new Error(r.error ?? "본사 KPI 조회 실패");
  return r;
}

/** 지점 운영 대시보드 (HQ는 지점 지정, 지점관리자는 자기 지점) */
export async function getBranchOpsDashboard(branchId?: string): Promise<BranchOpsDashboard> {
  const { data, error } = await supabase.rpc(
    "get_branch_ops_dashboard" as "get_survey_results_summary",
    (branchId ? { p_branch_id: branchId } : {}) as unknown as { p_survey_template_id: string }
  );
  if (error) throw new Error(error.message);
  const r = data as unknown as { success: boolean; error?: string } & BranchOpsDashboard;
  if (!r.success) throw new Error(r.error ?? "지점 운영 KPI 조회 실패");
  return r;
}

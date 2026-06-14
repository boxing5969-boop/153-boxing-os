/**
 * CRM ↔ Workers 일일 경영 성과 리포트 API 서비스
 * 모든 쓰기는 Workers(/api/reports) 경유. 응답 { success, data, message? }.
 */
import { supabase } from "@/integrations/supabase/client";

const baseUrl = import.meta.env.VITE_API_BASE_URL as string;

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, { headers: await authHeaders(), ...opts });
  const json = (await res.json()) as { success: boolean; data: T; message?: string; error?: { message?: string } };
  if (!res.ok || !json.success) throw new Error(json.error?.message ?? json.message ?? `HTTP ${res.status}`);
  return json.data;
}

// ── 타입 ─────────────────────────────────────────────────────

/** 입력으로 다루는 리포트 필드(수치 + 메모). */
export interface DailyReportFields {
  revenue_pt: number;
  revenue_membership: number;
  revenue_goods: number;
  revenue_dan: number;
  inquiry_count: number;
  new_signups: number;
  re_signups: number;
  pending_count: number;
  pipeline_action_plan: string | null;
  morning_attendance: number;
  lunch_attendance: number;
  evening_attendance: number;
  morning_note: string | null;
  lunch_note: string | null;
  evening_note: string | null;
  inactive_contacted: number;
  inactive_reached: number;
  inactive_returned: number;
  promotion_candidates: string | null;
  facility_issue: string | null;
  decision_issue: string | null;
  decision_proposal: string | null;
  decision_request: string | null;
}

export interface DailyReport extends DailyReportFields {
  id: string;
  branch_id: string;
  report_date: string;
  author_profile_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChecklistItem {
  no: number;
  label: string;
  done: boolean;
  memo: string;
}

export interface ReportSummary {
  day_total: number;
  month_cumulative: number;
  target_amount: number;
  achievement: number | null; // 목표 0/미설정이면 null
  gap: number;
  d_day: number;
}

export interface DailyFormData {
  report: DailyReport | null;
  checklist: { items: ChecklistItem[] } | null;
  summary: ReportSummary;
  editable: boolean;
}

export interface OverviewBranch extends ReportSummary {
  branch_id: string;
  branch_name: string;
}

export interface TrendRow {
  report_date: string;
  revenue_pt: number;
  revenue_membership: number;
  revenue_goods: number;
  revenue_dan: number;
}

// ── API ──────────────────────────────────────────────────────

export function getDailyForm(branchId: string, date: string): Promise<DailyFormData> {
  return apiFetch(`/api/reports/daily?branch_id=${encodeURIComponent(branchId)}&date=${encodeURIComponent(date)}`);
}

export function saveDaily(input: DailyReportFields & { branch_id: string; report_date: string }): Promise<unknown> {
  return apiFetch(`/api/reports/daily`, { method: "PUT", body: JSON.stringify(input) });
}

export function saveChecklist(branch_id: string, report_date: string, items: ChecklistItem[]): Promise<unknown> {
  return apiFetch(`/api/reports/checklist`, {
    method: "PUT",
    body: JSON.stringify({ branch_id, report_date, items }),
  });
}

export function saveMonthlyTarget(branch_id: string, year: number, month: number, target_amount: number): Promise<unknown> {
  return apiFetch(`/api/reports/monthly-target`, {
    method: "PUT",
    body: JSON.stringify({ branch_id, year, month, target_amount }),
  });
}

export function getTrend(branchId: string, year: number, month: number): Promise<{ rows: TrendRow[] }> {
  return apiFetch(`/api/reports/trend?branch_id=${encodeURIComponent(branchId)}&year=${year}&month=${month}`);
}

export function getOverview(date: string): Promise<{ date: string; branches: OverviewBranch[] }> {
  return apiFetch(`/api/reports/overview?date=${encodeURIComponent(date)}`);
}

/** 빈 리포트 필드(폼 초기값) */
export function emptyReportFields(): DailyReportFields {
  return {
    revenue_pt: 0, revenue_membership: 0, revenue_goods: 0, revenue_dan: 0,
    inquiry_count: 0, new_signups: 0, re_signups: 0, pending_count: 0, pipeline_action_plan: null,
    morning_attendance: 0, lunch_attendance: 0, evening_attendance: 0,
    morning_note: null, lunch_note: null, evening_note: null,
    inactive_contacted: 0, inactive_reached: 0, inactive_returned: 0,
    promotion_candidates: null, facility_issue: null,
    decision_issue: null, decision_proposal: null, decision_request: null,
  };
}

/**
 * HR 서비스 레이어 — 직원 / 계약서 / 급여
 */
import { supabase } from "@/integrations/supabase/client";

const BASE = import.meta.env.VITE_API_BASE_URL as string;

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
  const json = await res.json() as { success: boolean; data?: T; message?: string; error?: { message?: string } };
  if (!json.success) throw new Error(json.error?.message ?? json.message ?? `HTTP ${res.status}`);
  return json.data as T;
}

// ── 타입 ─────────────────────────────────────────────────────

export type EmploymentType = "regular" | "parttime" | "freelancer" | "owner";
export type StaffStatus = "active" | "inactive" | "resigned";
export type ContractType = "employment" | "parttime" | "freelance" | "renewal" | "other";
export type ContractStatus = "draft" | "sent" | "signed" | "expired" | "canceled";
export type PayrollStatus = "draft" | "confirmed" | "paid";

export interface Staff {
  id: string;
  branch_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  birth_date: string | null;
  gender: "male" | "female" | "other" | null;
  bank_name: string | null;
  bank_account: string | null;
  bank_holder: string | null;
  employment_type: EmploymentType;
  position: string | null;
  start_date: string | null;
  end_date: string | null;
  base_salary: number | null;
  hourly_wage: number | null;
  weekly_hours: number | null;
  status: StaffStatus;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface StaffContract {
  id: string;
  staff_id: string;
  branch_id: string;
  contract_type: ContractType;
  title: string;
  content: Record<string, unknown> | null;
  file_url: string | null;
  status: ContractStatus;
  valid_from: string | null;
  valid_until: string | null;
  sent_at: string | null;
  sent_to_phone: string | null;
  signed_at: string | null;
  created_at: string;
}

export interface PayrollCalculation {
  gross_pay: number;
  national_pension: number;
  health_insurance: number;
  long_term_care: number;
  employment_insurance: number;
  income_tax: number;
  local_income_tax: number;
  withholding_tax: number;
  total_deduction: number;
  net_pay: number;
  employer_pension: number;
  employer_health: number;
  employer_long_term_care: number;
  employer_employment: number;
  employer_accident: number;
  employer_total: number;
}

export interface StaffPayroll extends PayrollCalculation {
  id: string;
  staff_id: string;
  branch_id: string;
  year: number;
  month: number;
  base_pay: number;
  allowance: number;
  bonus: number;
  work_hours: number | null;
  work_days: number | null;
  memo: string | null;
  status: PayrollStatus;
  paid_at: string | null;
  created_at: string;
}

export interface PayrollSummary {
  year: number;
  monthly: Array<{
    month: number;
    gross_pay: number;
    net_pay: number;
    total_deduction: number;
    employer_total: number;
    total_cost: number;
    count: number;
  }>;
  annual_total: number;
}

// ── 직원 API ─────────────────────────────────────────────────

export async function listStaff(branchId: string, status?: StaffStatus): Promise<Staff[]> {
  const qs = status ? `?status=${status}` : "";
  return apiFetch<Staff[]>(`/api/hr/branches/${branchId}/staff${qs}`);
}

export async function getStaff(staffId: string): Promise<Staff> {
  return apiFetch<Staff>(`/api/hr/staff/${staffId}`);
}

export async function createStaff(branchId: string, body: Partial<Staff>): Promise<Staff> {
  return apiFetch<Staff>(`/api/hr/branches/${branchId}/staff`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateStaff(staffId: string, body: Partial<Staff>): Promise<Staff> {
  return apiFetch<Staff>(`/api/hr/staff/${staffId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function resignStaff(staffId: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/api/hr/staff/${staffId}`, { method: "DELETE" });
}

// ── 계약서 API ───────────────────────────────────────────────

export async function listContracts(staffId: string): Promise<StaffContract[]> {
  return apiFetch<StaffContract[]>(`/api/hr/staff/${staffId}/contracts`);
}

export async function getContract(contractId: string): Promise<StaffContract> {
  return apiFetch<StaffContract>(`/api/hr/contracts/${contractId}`);
}

export async function createContract(staffId: string, body: Partial<StaffContract>): Promise<StaffContract> {
  return apiFetch<StaffContract>(`/api/hr/staff/${staffId}/contracts`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateContract(contractId: string, body: Partial<StaffContract>): Promise<StaffContract> {
  return apiFetch<StaffContract>(`/api/hr/contracts/${contractId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function sendContract(contractId: string): Promise<{ sent_to: string }> {
  return apiFetch<{ sent_to: string }>(`/api/hr/contracts/${contractId}/send`, { method: "POST" });
}

// ── 급여 API ─────────────────────────────────────────────────

export async function listPayroll(staffId: string, year?: number): Promise<StaffPayroll[]> {
  const qs = year ? `?year=${year}` : "";
  return apiFetch<StaffPayroll[]>(`/api/hr/staff/${staffId}/payroll${qs}`);
}

export async function getBranchPayroll(branchId: string, year?: number, month?: number): Promise<StaffPayroll[]> {
  const params = new URLSearchParams();
  if (year) params.set("year", String(year));
  if (month) params.set("month", String(month));
  const qs = params.toString() ? `?${params}` : "";
  return apiFetch<StaffPayroll[]>(`/api/hr/branches/${branchId}/payroll${qs}`);
}

export async function createPayroll(staffId: string, body: {
  year: number; month: number; base_pay: number;
  allowance?: number; bonus?: number; work_hours?: number;
  work_days?: number; memo?: string; status?: PayrollStatus;
  override?: Record<string, number>;
}): Promise<StaffPayroll & { calculation: PayrollCalculation }> {
  return apiFetch(`/api/hr/staff/${staffId}/payroll`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updatePayrollStatus(
  payrollId: string,
  status: PayrollStatus
): Promise<StaffPayroll> {
  return apiFetch<StaffPayroll>(`/api/hr/payroll/${payrollId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export async function getPayrollSummary(branchId: string, year?: number): Promise<PayrollSummary> {
  const qs = year ? `?year=${year}` : "";
  return apiFetch<PayrollSummary>(`/api/hr/branches/${branchId}/payroll/summary${qs}`);
}

export async function calculatePayroll(body: {
  employment_type: EmploymentType;
  base_pay: number;
  allowance?: number;
  bonus?: number;
  work_hours?: number;
  hourly_wage?: number;
}): Promise<PayrollCalculation> {
  return apiFetch<PayrollCalculation>(`/api/hr/payroll/calculate`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── 유틸 ─────────────────────────────────────────────────────

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  regular: "정직원",
  parttime: "파트타임",
  freelancer: "프리랜서",
  owner: "대표/관장",
};

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  employment: "근로계약서",
  parttime: "단시간 근로계약서",
  freelance: "프리랜서 계약서",
  renewal: "재계약서",
  other: "기타",
};

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: "초안",
  sent: "발송됨",
  signed: "서명완료",
  expired: "만료",
  canceled: "취소",
};

export const PAYROLL_STATUS_LABELS: Record<PayrollStatus, string> = {
  draft: "초안",
  confirmed: "확정",
  paid: "지급완료",
};

export function formatKRW(amount: number): string {
  return amount.toLocaleString("ko-KR") + "원";
}

/** 계약서 본문 기본 템플릿 생성 */
export function getContractTemplate(
  contractType: ContractType,
  staff: Partial<Staff>,
  branchName: string
): Record<string, unknown> {
  const today = new Date().toISOString().slice(0, 10);

  const base = {
    company_name: `153복싱짐 ${branchName}`,
    employee_name: staff.name ?? "",
    employee_birth: staff.birth_date ?? "",
    created_date: today,
  };

  if (contractType === "employment" || contractType === "renewal") {
    return {
      ...base,
      start_date: staff.start_date ?? today,
      end_date: staff.end_date ?? "",
      position: staff.position ?? "",
      base_salary: staff.base_salary ?? 0,
      work_hours_per_week: 40,
      work_days: "월~금",
      work_time: "09:00~18:00",
      rest_time: "12:00~13:00 (1시간)",
      probation_months: 3,
      clauses: [
        "본 계약서에 명시되지 않은 사항은 근로기준법을 따른다.",
        "급여는 매월 25일에 지급한다.",
        "퇴직금은 1년 이상 근무 시 근로기준법에 따라 지급한다.",
      ],
    };
  }

  if (contractType === "parttime") {
    return {
      ...base,
      start_date: staff.start_date ?? today,
      end_date: staff.end_date ?? "",
      position: staff.position ?? "",
      hourly_wage: staff.hourly_wage ?? 0,
      weekly_hours: staff.weekly_hours ?? 0,
      work_schedule: "",
      clauses: [
        "시급은 시간당 위에 기재된 금액으로 한다.",
        "급여는 매월 25일에 지급한다.",
        "주 15시간 이상 근무 시 주휴수당이 발생한다.",
        "본 계약서에 명시되지 않은 사항은 근로기준법을 따른다.",
      ],
    };
  }

  if (contractType === "freelance") {
    return {
      ...base,
      start_date: staff.start_date ?? today,
      end_date: staff.end_date ?? "",
      service_description: "피트니스 트레이닝 서비스",
      fee: staff.base_salary ?? 0,
      fee_cycle: "월",
      withholding_rate: "3.3%",
      clauses: [
        "을은 독립적 사업자로서 활동하며, 갑의 직원이 아니다.",
        "을은 업무 수행에 필요한 도구와 장비를 직접 조달한다.",
        "보수에서 원천세 3.3%를 공제 후 지급한다.",
        "계약기간 중 일방적 해지 시 30일 전 서면 통보를 요한다.",
      ],
    };
  }

  return base;
}

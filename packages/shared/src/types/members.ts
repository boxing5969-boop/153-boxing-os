export type MemberStatus =
  | "active"
  | "trial"
  | "expired"
  | "suspended"
  | "unpaid"
  | "withdrawn";

export type PaymentStatus = "paid" | "unpaid" | "partial" | "refunded";
export type MembershipStatus = "active" | "expired" | "paused" | "canceled";
export type TrialPassStatus = "active" | "used" | "expired" | "canceled";

export interface Member {
  id: string;
  company_id: string;
  branch_id: string;
  name: string;
  phone: string | null;
  birth_date: string | null;
  gender: string | null;
  status: MemberStatus;
  assigned_coach_id: string | null;
  ranking_app_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Membership {
  id: string;
  member_id: string;
  branch_id: string;
  plan_name: string;
  start_date: string;
  end_date: string;
  payment_status: PaymentStatus;
  status: MembershipStatus;
  price?: number | null;
  currency?: string;
  // 홀딩 관련
  hold_start?: string | null;        // 현재 홀딩 시작일
  hold_end?: string | null;          // 현재 홀딩 예정 종료일
  total_held_days?: number | null;   // 누적 홀딩 일수
  // 환불 관련
  refund_amount?: number | null;
  refund_reason?: string | null;
  refunded_at?: string | null;
  // 메모
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrialPass {
  id: string;
  member_id: string;
  branch_id: string;
  start_at: string;
  end_at: string;
  max_entries: number;
  used_entries: number;
  status: TrialPassStatus;
  created_at: string;
}

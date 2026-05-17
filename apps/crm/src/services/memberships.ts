import { supabase } from "@/integrations/supabase/client";
import type { Membership, MembershipStatus, PaymentStatus } from "@153/shared";

export interface MembershipRow extends Membership {
  member_name?: string;
}

export interface MembershipListFilters {
  branch_id?: string | null;
  status?: MembershipStatus | null;
  payment_status?: PaymentStatus | null;
  member_id?: string | null;
  limit?: number;
  offset?: number;
}

export interface MembershipListResult {
  rows: MembershipRow[];
  total: number;
}

export async function listMemberships(
  filters: MembershipListFilters = {}
): Promise<MembershipListResult> {
  const limit = filters.limit ?? 20;
  const offset = filters.offset ?? 0;

  let query = supabase
    .from("memberships")
    .select("*, members(name)", { count: "exact" })
    .order("end_date", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.branch_id) query = query.eq("branch_id", filters.branch_id);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.payment_status) query = query.eq("payment_status", filters.payment_status);
  if (filters.member_id) query = query.eq("member_id", filters.member_id);

  const { data, error, count } = await query;
  if (error) throw error;

  type Joined = Membership & { members?: { name: string } | null };
  const rows = ((data ?? []) as unknown as Joined[]).map(({ members, ...m }) => ({
    ...m,
    member_name: members?.name,
  }));
  return { rows, total: count ?? 0 };
}

export interface CreateMembershipInput {
  member_id: string;
  branch_id: string;
  plan_name: string;
  plan_type?: string | null;
  start_date: string;
  end_date: string;
  payment_status?: PaymentStatus;
  price?: number | null;
  currency?: string;
  max_sessions?: number | null;
}

export async function createMembership(input: CreateMembershipInput): Promise<Membership> {
  const { data, error } = await supabase
    .from("memberships")
    .insert({
      member_id:    input.member_id,
      branch_id:    input.branch_id,
      plan_name:    input.plan_name,
      plan_type:    input.plan_type ?? null,
      start_date:   input.start_date,
      end_date:     input.end_date,
      payment_status: input.payment_status ?? "paid",
      status:       "active",
      price:        input.price ?? null,
      currency:     input.currency ?? "KRW",
      max_sessions: input.max_sessions ?? null,
      used_sessions: 0,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as Membership;
}

export async function updateMembershipState(
  id: string,
  patch: { status?: MembershipStatus; payment_status?: PaymentStatus }
): Promise<Membership> {
  const { data, error } = await supabase
    .from("memberships")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as Membership;
}

// ── 홀딩 시작
export interface StartHoldInput {
  membership_id: string;
  hold_start: string;   // YYYY-MM-DD
  hold_end?: string;    // YYYY-MM-DD (없으면 무기한)
  reason?: string;
}

export async function startMembershipHold(input: StartHoldInput): Promise<{ hold_id: string }> {
  const { data, error } = await supabase.rpc("start_membership_hold", {
    _membership_id: input.membership_id,
    _hold_start:    input.hold_start,
    _hold_end:      input.hold_end ?? null,
    _reason:        input.reason ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { hold_id: string };
}

// ── 홀딩 해제 (재개)
export async function resumeMembershipHold(
  membershipId: string,
  resumeDate?: string
): Promise<{ days_held: number; new_end_date: string }> {
  const { data, error } = await supabase.rpc("resume_membership_hold", {
    _membership_id: membershipId,
    _resume_date:   resumeDate ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { days_held: number; new_end_date: string };
}

// ── 환불 처리
export interface RefundMembershipInput {
  membership_id: string;
  refund_amount?: number;
  refund_reason?: string;
}

export async function refundMembership(input: RefundMembershipInput): Promise<void> {
  const { error } = await supabase.rpc("refund_membership", {
    _membership_id: input.membership_id,
    _refund_amount: input.refund_amount ?? null,
    _refund_reason: input.refund_reason ?? null,
  });
  if (error) throw new Error(error.message);
}

// ── 메모 저장
export async function saveMembershipNotes(id: string, notes: string): Promise<void> {
  const { error } = await supabase
    .from("memberships")
    .update({ notes })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

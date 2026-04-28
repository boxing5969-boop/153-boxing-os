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
  start_date: string;
  end_date: string;
  payment_status?: PaymentStatus;
}

export async function createMembership(input: CreateMembershipInput): Promise<Membership> {
  const { data, error } = await supabase
    .from("memberships")
    .insert({
      member_id: input.member_id,
      branch_id: input.branch_id,
      plan_name: input.plan_name,
      start_date: input.start_date,
      end_date: input.end_date,
      payment_status: input.payment_status ?? "paid",
      status: "active",
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

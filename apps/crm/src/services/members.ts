import { supabase } from "@/integrations/supabase/client";
import type { Member, MemberStatus, Membership, TrialPass } from "@153/shared";

export interface MemberListFilters {
  branch_id?: string | null;
  status?: MemberStatus | null;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface MemberListResult {
  rows: Member[];
  total: number;
}

export async function listMembers(filters: MemberListFilters = {}): Promise<MemberListResult> {
  const limit = filters.limit ?? 20;
  const offset = filters.offset ?? 0;

  let query = supabase
    .from("members")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.branch_id) query = query.eq("branch_id", filters.branch_id);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.q && filters.q.trim()) {
    const safe = filters.q.trim().replace(/[%_]/g, "\\$&");
    query = query.or(`name.ilike.%${safe}%,phone.ilike.%${safe}%`);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as Member[], total: count ?? 0 };
}

export async function getMember(id: string): Promise<Member | null> {
  const { data, error } = await supabase
    .from("members")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Member | null) ?? null;
}

export interface CreateMemberInput {
  company_id: string;
  branch_id: string;
  name: string;
  phone?: string;
  birth_date?: string;
  gender?: string;
  status?: MemberStatus;
  assigned_coach_id?: string | null;
}

export async function createMember(input: CreateMemberInput): Promise<Member> {
  const { data, error } = await supabase
    .from("members")
    .insert({
      company_id: input.company_id,
      branch_id: input.branch_id,
      name: input.name,
      phone: input.phone ?? null,
      birth_date: input.birth_date ?? null,
      gender: input.gender ?? null,
      status: input.status ?? "trial",
      assigned_coach_id: input.assigned_coach_id ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as Member;
}

export async function linkRankingAppUser(
  memberId: string,
  rankingUserId: string | null
): Promise<Member> {
  const { data, error } = await supabase
    .from("members")
    .update({ ranking_app_user_id: rankingUserId })
    .eq("id", memberId)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as Member;
}

export interface MemberRelated {
  memberships: Membership[];
  trials: TrialPass[];
}

export async function getMemberRelated(memberId: string): Promise<MemberRelated> {
  const [ms, tp] = await Promise.all([
    supabase
      .from("memberships")
      .select("*")
      .eq("member_id", memberId)
      .order("end_date", { ascending: false }),
    supabase
      .from("trial_passes")
      .select("*")
      .eq("member_id", memberId)
      .order("end_at", { ascending: false }),
  ]);
  if (ms.error) throw ms.error;
  if (tp.error) throw tp.error;
  return {
    memberships: (ms.data ?? []) as unknown as Membership[],
    trials: (tp.data ?? []) as unknown as TrialPass[],
  };
}

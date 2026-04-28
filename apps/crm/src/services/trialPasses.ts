import { supabase } from "@/integrations/supabase/client";
import type { TrialPass, TrialPassStatus } from "@153/shared";

export interface TrialPassRow extends TrialPass {
  member_name?: string;
}

export interface TrialPassListFilters {
  branch_id?: string | null;
  status?: TrialPassStatus | null;
  member_id?: string | null;
  limit?: number;
  offset?: number;
}

export interface TrialPassListResult {
  rows: TrialPassRow[];
  total: number;
}

export async function listTrialPasses(
  filters: TrialPassListFilters = {}
): Promise<TrialPassListResult> {
  const limit = filters.limit ?? 20;
  const offset = filters.offset ?? 0;

  let query = supabase
    .from("trial_passes")
    .select("*, members(name)", { count: "exact" })
    .order("end_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.branch_id) query = query.eq("branch_id", filters.branch_id);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.member_id) query = query.eq("member_id", filters.member_id);

  const { data, error, count } = await query;
  if (error) throw error;

  type Joined = TrialPass & { members?: { name: string } | null };
  const rows = ((data ?? []) as unknown as Joined[]).map(({ members, ...t }) => ({
    ...t,
    member_name: members?.name,
  }));
  return { rows, total: count ?? 0 };
}

export interface CreateTrialPassInput {
  member_id: string;
  branch_id: string;
  start_at: string;
  end_at: string;
  max_entries: number;
}

export async function createTrialPass(input: CreateTrialPassInput): Promise<TrialPass> {
  const { data, error } = await supabase
    .from("trial_passes")
    .insert({
      member_id: input.member_id,
      branch_id: input.branch_id,
      start_at: input.start_at,
      end_at: input.end_at,
      max_entries: input.max_entries,
      used_entries: 0,
      status: "active",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as TrialPass;
}

export async function cancelTrialPass(id: string): Promise<TrialPass> {
  const { data, error } = await supabase
    .from("trial_passes")
    .update({ status: "canceled" })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as TrialPass;
}

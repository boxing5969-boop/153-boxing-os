import { supabase } from "@/integrations/supabase/client";
import type { VisitPurpose, VisitorRequest, VisitorRequestStatus } from "@153/shared";

export interface VisitorRow extends VisitorRequest {
  branch_name?: string;
}

export interface VisitorListFilters {
  branch_id?: string | null;
  status?: VisitorRequestStatus | null;
  limit?: number;
  offset?: number;
}

export interface VisitorListResult {
  rows: VisitorRow[];
  total: number;
}

export async function listVisitors(
  filters: VisitorListFilters = {}
): Promise<VisitorListResult> {
  const limit = filters.limit ?? 20;
  const offset = filters.offset ?? 0;
  let query = supabase
    .from("visitor_requests")
    .select("*, branch:branches(name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.branch_id) query = query.eq("branch_id", filters.branch_id);
  if (filters.status) query = query.eq("status", filters.status);

  const { data, error, count } = await query;
  if (error) throw error;

  type Joined = VisitorRequest & { branch?: { name: string } | null };
  const rows = ((data ?? []) as unknown as Joined[]).map(({ branch, ...v }) => ({
    ...v,
    branch_name: branch?.name,
  }));
  return { rows, total: count ?? 0 };
}

export interface CreateVisitorInput {
  branch_id: string;
  name: string;
  phone: string;
  purpose: VisitPurpose;
  visit_at?: string | null;
}

export async function createVisitor(input: CreateVisitorInput): Promise<VisitorRequest> {
  const { data, error } = await supabase
    .from("visitor_requests")
    .insert({
      branch_id: input.branch_id,
      name: input.name,
      phone: input.phone,
      purpose: input.purpose,
      visit_at: input.visit_at ?? null,
      status: "requested",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as VisitorRequest;
}

export async function updateVisitorStatus(
  id: string,
  status: VisitorRequestStatus,
  approvedBy?: string | null
): Promise<VisitorRequest> {
  const patch: Record<string, unknown> = { status };
  if (approvedBy !== undefined) patch.approved_by = approvedBy;
  const { data, error } = await supabase
    .from("visitor_requests")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as VisitorRequest;
}

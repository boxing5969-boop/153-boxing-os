import { supabase } from "@/integrations/supabase/client";

export interface BranchLookup {
  id: string;
  name: string;
  company_id: string;
}

export interface CoachLookup {
  id: string;
  name: string;
  branch_id: string | null;
}

export async function listBranches(): Promise<BranchLookup[]> {
  const { data, error } = await supabase
    .from("branches")
    .select("id,name,company_id")
    .order("name");
  if (error) throw error;
  return (data ?? []) as unknown as BranchLookup[];
}

export async function listCoaches(branchId?: string | null): Promise<CoachLookup[]> {
  let query = supabase.from("profiles").select("id,name,branch_id").eq("role", "coach");
  if (branchId) query = query.eq("branch_id", branchId);
  const { data, error } = await query.order("name");
  if (error) throw error;
  return (data ?? []) as unknown as CoachLookup[];
}

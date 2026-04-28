import { supabase } from "@/integrations/supabase/client";

export interface BranchStats {
  id: string;
  company_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  status: string;
  created_at: string;
  member_count: number;
  active_member_count: number;
}

export async function getBranchesWithStats(): Promise<BranchStats[]> {
  const { data, error } = await supabase.from("branches").select("*").order("name");
  if (error) throw error;
  type BranchRow = Omit<BranchStats, "member_count" | "active_member_count">;
  const rows = ((data ?? []) as unknown as BranchRow[]) ?? [];

  const counts = await Promise.all(
    rows.map(async (b) => {
      const [total, active] = await Promise.all([
        supabase
          .from("members")
          .select("id", { count: "exact", head: true })
          .eq("branch_id", b.id),
        supabase
          .from("members")
          .select("id", { count: "exact", head: true })
          .eq("branch_id", b.id)
          .eq("status", "active"),
      ]);
      return { id: b.id, total: total.count ?? 0, active: active.count ?? 0 };
    })
  );

  const map = new Map(counts.map((c) => [c.id, c]));
  return rows.map((b) => ({
    ...b,
    member_count: map.get(b.id)?.total ?? 0,
    active_member_count: map.get(b.id)?.active ?? 0,
  }));
}

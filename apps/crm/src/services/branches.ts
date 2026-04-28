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
  device_count: number;
}

export interface BranchDetail extends BranchStats {
  manager_name: string | null;
  manager_phone: string | null;
}

export interface CreateBranchInput {
  company_id: string;
  name: string;
  address?: string;
  phone?: string;
}

export interface UpdateBranchInput {
  name?: string;
  address?: string;
  phone?: string;
  status?: string;
}

export async function getBranchesWithStats(): Promise<BranchStats[]> {
  const { data, error } = await supabase.from("branches").select("*").order("name");
  if (error) throw error;
  type BranchRow = Omit<BranchStats, "member_count" | "active_member_count" | "device_count">;
  const rows = ((data ?? []) as unknown as BranchRow[]) ?? [];

  const counts = await Promise.all(
    rows.map(async (b) => {
      const [total, active, devices] = await Promise.all([
        supabase.from("members").select("id", { count: "exact", head: true }).eq("branch_id", b.id),
        supabase.from("members").select("id", { count: "exact", head: true }).eq("branch_id", b.id).eq("status", "active"),
        supabase.from("access_devices").select("id", { count: "exact", head: true }).eq("branch_id", b.id),
      ]);
      return { id: b.id, total: total.count ?? 0, active: active.count ?? 0, devices: devices.count ?? 0 };
    })
  );

  const map = new Map(counts.map((c) => [c.id, c]));
  return rows.map((b) => ({
    ...b,
    member_count: map.get(b.id)?.total ?? 0,
    active_member_count: map.get(b.id)?.active ?? 0,
    device_count: map.get(b.id)?.devices ?? 0,
  }));
}

export async function getBranchDetail(id: string): Promise<BranchDetail | null> {
  const { data, error } = await supabase.from("branches").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;

  type BranchRow = Omit<BranchStats, "member_count" | "active_member_count" | "device_count">;
  const b = data as unknown as BranchRow;

  const [total, active, devices, manager] = await Promise.all([
    supabase.from("members").select("id", { count: "exact", head: true }).eq("branch_id", id),
    supabase.from("members").select("id", { count: "exact", head: true }).eq("branch_id", id).eq("status", "active"),
    supabase.from("access_devices").select("id", { count: "exact", head: true }).eq("branch_id", id),
    supabase.from("profiles").select("name, phone").eq("branch_id", id).eq("role", "branch_admin").maybeSingle(),
  ]);

  type ManagerRow = { name: string; phone: string | null } | null;
  const mgr = manager.data as ManagerRow;

  return {
    ...b,
    member_count: total.count ?? 0,
    active_member_count: active.count ?? 0,
    device_count: devices.count ?? 0,
    manager_name: mgr?.name ?? null,
    manager_phone: mgr?.phone ?? null,
  };
}

export async function createBranch(input: CreateBranchInput) {
  const { data, error } = await supabase.from("branches").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateBranch(id: string, input: UpdateBranchInput) {
  const { data, error } = await supabase.from("branches").update(input).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

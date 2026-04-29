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
  kakao_pfid: string | null;
  kakao_sender_phone: string | null;
  kakao_tpl_d7: string | null;
  kakao_tpl_d3: string | null;
  kakao_tpl_d1: string | null;
  kakao_enabled: boolean;
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
  const { data, error } = await supabase.from("branches").select("*,kakao_pfid,kakao_sender_phone,kakao_tpl_d7,kakao_tpl_d3,kakao_tpl_d1,kakao_enabled").eq("id", id).maybeSingle();
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

  type BranchRowFull = BranchRow & { kakao_pfid?: string | null; kakao_sender_phone?: string | null; kakao_tpl_d7?: string | null; kakao_tpl_d3?: string | null; kakao_tpl_d1?: string | null; kakao_enabled?: boolean };
  const bFull = b as BranchRowFull;
  return {
    ...b,
    member_count: total.count ?? 0,
    active_member_count: active.count ?? 0,
    device_count: devices.count ?? 0,
    manager_name: mgr?.name ?? null,
    manager_phone: mgr?.phone ?? null,
    kakao_pfid: bFull.kakao_pfid ?? null,
    kakao_sender_phone: bFull.kakao_sender_phone ?? null,
    kakao_tpl_d7: bFull.kakao_tpl_d7 ?? null,
    kakao_tpl_d3: bFull.kakao_tpl_d3 ?? null,
    kakao_tpl_d1: bFull.kakao_tpl_d1 ?? null,
    kakao_enabled: bFull.kakao_enabled ?? false,
  };
}

export async function createBranch(input: CreateBranchInput) {
  // TODO: 추후 Supabase Database 타입 생성 후 제거 (supabase gen types)
  const { data, error } = await supabase.from("branches").insert(input as unknown as Record<string, unknown>).select().single();
  if (error) throw error;
  return data;
}

export async function updateBranch(id: string, input: UpdateBranchInput) {
  // TODO: 추후 Supabase Database 타입 생성 후 제거 (supabase gen types)
  const { data, error } = await supabase.from("branches").update(input as unknown as Record<string, unknown>).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

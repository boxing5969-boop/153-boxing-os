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
  // 기존: 지점마다 (회원합/활성회원/단말기) 3쿼리 × N → 100지점에 300쿼리 N+1.
  // 변경: 지점 + 회원 전체(branch_id, status) + 단말기 전체(branch_id) 3쿼리만 발사하고
  // 클라이언트에서 group by 집계. RLS 가 본사 권한에 모든 회원 select 를 허용한다는 전제.
  const [branchesRes, membersRes, devicesRes] = await Promise.all([
    supabase.from("branches").select("*").order("name"),
    supabase.from("members").select("branch_id, status"),
    supabase.from("access_devices").select("branch_id"),
  ]);
  if (branchesRes.error) throw branchesRes.error;
  if (membersRes.error) throw membersRes.error;
  if (devicesRes.error) throw devicesRes.error;

  type BranchRow = Omit<BranchStats, "member_count" | "active_member_count" | "device_count">;
  const rows = ((branchesRes.data ?? []) as unknown as BranchRow[]) ?? [];

  const memberCounts = new Map<string, { total: number; active: number }>();
  for (const m of ((membersRes.data ?? []) as unknown as { branch_id: string; status: string }[])) {
    const c = memberCounts.get(m.branch_id) ?? { total: 0, active: 0 };
    c.total += 1;
    if (m.status === "active") c.active += 1;
    memberCounts.set(m.branch_id, c);
  }

  const deviceCounts = new Map<string, number>();
  for (const d of ((devicesRes.data ?? []) as unknown as { branch_id: string }[])) {
    deviceCounts.set(d.branch_id, (deviceCounts.get(d.branch_id) ?? 0) + 1);
  }

  return rows.map((b) => ({
    ...b,
    member_count: memberCounts.get(b.id)?.total ?? 0,
    active_member_count: memberCounts.get(b.id)?.active ?? 0,
    device_count: deviceCounts.get(b.id) ?? 0,
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

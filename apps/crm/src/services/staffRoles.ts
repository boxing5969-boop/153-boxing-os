/**
 * 역할 배정(staff_roles) 서비스 — Phase B 후속 1단계
 * - staff_roles: 한 직원이 organization/brand/branch 스코프로 여러 역할 보유 가능
 * - RLS: is_org_admin 만 쓰기 가능(staff_roles_pb_write)
 */
import { supabase } from "@/integrations/supabase/client";

export type StaffRoleScope = "organization" | "brand" | "branch";
export type StaffRoleStatus = "active" | "inactive";

/** 이 UI에서 배정 가능한 역할 (super_admin/hq_admin/member 제외) */
export const ASSIGNABLE_ROLES = [
  "owner", "brand_manager", "branch_manager", "staff", "coach", "accountant", "viewer",
] as const;

export const ROLE_LABELS: Record<string, string> = {
  super_admin: "최고관리자", hq_admin: "본사관리자", owner: "조직 소유자",
  brand_manager: "브랜드 관리자", branch_owner: "지점주", branch_manager: "지점 관리자",
  staff: "지점 직원", coach: "코치", accountant: "정산 담당", viewer: "조회 전용",
  member: "회원",
};

export const SCOPE_LABELS: Record<StaffRoleScope, string> = {
  organization: "조직 전체", brand: "브랜드", branch: "지점",
};

export interface StaffRole {
  id: string;
  profile_id: string;
  company_id: string;
  brand_id: string | null;
  branch_id: string | null;
  role: string;
  scope: StaffRoleScope;
  status: StaffRoleStatus;
  created_at: string;
  profile_name: string | null;
  branch_name: string | null;
  brand_name: string | null;
}

export interface AssignStaffRoleInput {
  profile_id: string;
  company_id: string;
  role: string;
  scope: StaffRoleScope;
  brand_id?: string | null;
  branch_id?: string | null;
}

export interface LookupRow { id: string; name: string }

/** 역할 배정 목록 */
export async function listStaffRoles(companyId: string): Promise<StaffRole[]> {
  const { data, error } = await supabase
    .from("staff_roles" as "members")
    .select("*, profiles(name), branches(name), brands(name)")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown[]).map((r) => {
    const row = r as StaffRole & {
      profiles?: { name: string } | null;
      branches?: { name: string } | null;
      brands?: { name: string } | null;
    };
    return {
      ...row,
      profile_name: row.profiles?.name ?? null,
      branch_name: row.branches?.name ?? null,
      brand_name: row.brands?.name ?? null,
    };
  });
}

/** 배정 가능한 직원(프로필) 목록 */
export async function listAssignableProfiles(companyId: string): Promise<LookupRow[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name")
    .eq("company_id", companyId)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LookupRow[];
}

/** 브랜드 목록 */
export async function listBrands(companyId: string): Promise<LookupRow[]> {
  const { data, error } = await supabase
    .from("brands" as "members")
    .select("id, name")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LookupRow[];
}

/** 지점 목록 */
export async function listBranchesLookup(companyId: string): Promise<LookupRow[]> {
  const { data, error } = await supabase
    .from("branches")
    .select("id, name")
    .eq("company_id", companyId)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LookupRow[];
}

/** 역할 배정 */
export async function assignStaffRole(input: AssignStaffRoleInput): Promise<void> {
  const { error } = await supabase.from("staff_roles" as "members").insert({
    profile_id: input.profile_id,
    company_id: input.company_id,
    role: input.role,
    scope: input.scope,
    brand_id: input.brand_id ?? null,
    branch_id: input.branch_id ?? null,
    status: "active",
  } as unknown as Record<string, unknown>);
  if (error) throw new Error(error.message);
}

/** 활성/비활성 토글 */
export async function setStaffRoleStatus(id: string, status: StaffRoleStatus): Promise<void> {
  const { error } = await supabase
    .from("staff_roles" as "members")
    .update({ status } as unknown as Record<string, unknown>)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** 역할 배정 해제 (소프트 삭제) */
export async function removeStaffRole(id: string): Promise<void> {
  const { error } = await supabase
    .from("staff_roles" as "members")
    .update({ deleted_at: new Date().toISOString() } as unknown as Record<string, unknown>)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

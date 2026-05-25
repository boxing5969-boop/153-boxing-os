/**
 * 현재 사용자가 해당 tenant 에서 허용된 역할 중 하나를 가지는지 확인.
 *
 * 구현: service_role 클라이언트로 has_tenant_role RPC 호출.
 *   - 클라이언트가 보낸 tenant_id 를 그대로 검증 (위조 불가능 — DB 측 RLS 헬퍼와 동일 로직이지만
 *     여기는 service_role 이라 RLS 우회하므로 in-RPC 가 직접 auth.uid() 못 봄.
 *     대신 user_id 를 RPC 에 명시적으로 넘김.)
 *
 * RPC has_tenant_role 시그니처는 auth.uid() 기반인데, service_role 컨텍스트에선 auth.uid() 가 null.
 * → 이를 우회하기 위해 직접 SQL: profiles + staff_roles 조회.
 */
import { AppError, ForbiddenError } from "../lib/errors";
import { getSupabase } from "../lib/supabase";

export type TenantRoleScope =
  | "owner"
  | "hq_admin"
  | "super_admin"
  | "branch_owner"
  | "branch_manager"
  | "brand_manager"
  | "staff"
  | "coach"
  | "accountant"
  | "viewer";

/**
 * @throws ForbiddenError when user has no matching role
 */
export async function assertTenantRole(
  userId: string,
  tenantId: string,
  allowedRoles: TenantRoleScope[]
): Promise<void> {
  const supa = getSupabase();
  // profiles 1차 — 단일 역할
  const { data: profile, error: pErr } = await supa
    .from("profiles")
    .select("id, role, status, company_id")
    .eq("auth_user_id", userId)
    .eq("company_id", tenantId)
    .eq("status", "active")
    .maybeSingle();
  if (pErr) {
    throw new AppError("DB_ERROR", `profiles lookup failed: ${pErr.message}`, 500);
  }
  if (profile && allowedRoles.includes(profile.role as TenantRoleScope)) {
    return;
  }

  // staff_roles 2차 — 다중 역할
  if (profile?.id) {
    const { data: rows, error: srErr } = await supa
      .from("staff_roles")
      .select("role, status")
      .eq("profile_id", profile.id)
      .eq("company_id", tenantId)
      .eq("status", "active");
    if (srErr) {
      throw new AppError("DB_ERROR", `staff_roles lookup failed: ${srErr.message}`, 500);
    }
    if (rows && rows.some((r) => allowedRoles.includes(r.role as TenantRoleScope))) {
      return;
    }
  }

  throw new ForbiddenError(`user does not have required tenant role`, {
    tenantId,
    allowedRoles,
  });
}

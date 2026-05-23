/**
 * 권한 결정 헬퍼 — 순수 함수.
 *
 * CLAUDE.md 권한 원칙:
 *  - 본사(super_admin, hq_admin): 전체 지점 확인 가능
 *  - 가맹점주(branch_owner)/지점 관리자(branch_manager): 자기 지점만
 *  - 코치(coach): 담당 회원만
 *  - 회원(member): 자기 정보만
 *
 * 라우트 핸들러는 DB 에서 caller profile 을 가져온 뒤 이 헬퍼로 판단한다.
 * (DB 입출력은 라우트 책임 — 헬퍼는 순수)
 */
import type { UserRole } from "@153/shared";

export const HQ_ROLES = ["super_admin", "hq_admin"] as const satisfies readonly UserRole[];
export const BRANCH_ADMIN_ROLES = ["branch_owner", "branch_manager"] as const satisfies readonly UserRole[];
export const HQ_AND_BRANCH_ROLES = [...HQ_ROLES, ...BRANCH_ADMIN_ROLES] as const satisfies readonly UserRole[];
export const STAFF_ROLES = [...HQ_AND_BRANCH_ROLES, "coach"] as const satisfies readonly UserRole[];

export interface CallerProfile {
  id: string;
  role: UserRole;
  branch_id: string | null;
  company_id?: string | null;
}

export function isHqRole(role: UserRole | string): boolean {
  return (HQ_ROLES as readonly string[]).includes(role);
}

export function isBranchAdminRole(role: UserRole | string): boolean {
  return (BRANCH_ADMIN_ROLES as readonly string[]).includes(role);
}

export function isStaffRole(role: UserRole | string): boolean {
  return (STAFF_ROLES as readonly string[]).includes(role);
}

/**
 * 본사는 모든 지점 접근 가능, 그 외는 자기 지점만.
 * coach 도 자기 지점에 한정(담당 회원 필터는 별도).
 */
export function canAccessBranch(caller: CallerProfile, targetBranchId: string): boolean {
  if (isHqRole(caller.role)) return true;
  return caller.branch_id === targetBranchId;
}

/**
 * 코치가 특정 회원을 볼 수 있는지.
 *  - 본사·지점관리자: 자기 scope 안의 모든 회원
 *  - 코치: 본인이 assigned_coach_id 인 회원만
 *  - 그 외: 불가
 */
export function canAccessMember(
  caller: CallerProfile,
  member: { branch_id: string; assigned_coach_id: string | null },
): boolean {
  if (isHqRole(caller.role)) return true;
  if (isBranchAdminRole(caller.role)) {
    return caller.branch_id === member.branch_id;
  }
  if (caller.role === "coach") {
    return (
      caller.branch_id === member.branch_id &&
      member.assigned_coach_id === caller.id
    );
  }
  return false;
}

/**
 * 원격 문 오픈 — 본사·가맹점주만.
 * branch_owner 는 자기 지점 단말기에 한해서만.
 */
export function canRemoteOpenDoor(caller: CallerProfile, deviceBranchId: string): boolean {
  if (isHqRole(caller.role)) return true;
  if (caller.role === "branch_owner" || caller.role === "branch_manager") {
    return caller.branch_id === deviceBranchId;
  }
  return false;
}

/**
 * 비상 PIN 발급 — 본사·가맹점주.
 * 가맹점주는 자기 지점에만 발급 가능.
 */
export function canIssueEmergencyPin(caller: CallerProfile, targetBranchId: string): boolean {
  if (isHqRole(caller.role)) return true;
  if (caller.role === "branch_owner" || caller.role === "branch_manager") {
    return caller.branch_id === targetBranchId;
  }
  return false;
}

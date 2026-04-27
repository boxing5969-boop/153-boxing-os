import type { UserRole } from "@153/shared";

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "본사 최고관리자",
  hq_admin: "본사 관리자",
  branch_owner: "가맹점주",
  branch_manager: "지점 관리자",
  coach: "코치",
  member: "회원",
};

export function roleLabel(role: UserRole | undefined | null): string {
  if (!role) return "—";
  return ROLE_LABELS[role] ?? role;
}

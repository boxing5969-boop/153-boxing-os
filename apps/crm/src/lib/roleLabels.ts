import type { UserRole } from "@153/shared";

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "본사 최고관리자",
  hq_admin: "본사 관리자",
  branch_owner: "가맹점주",
  branch_manager: "지점 관리자",
  coach: "코치",
  member: "회원",
  // Phase B 멀티테넌트 역할 확장
  owner: "조직 소유자",
  brand_manager: "브랜드 관리자",
  staff: "지점 직원",
  accountant: "정산 담당",
  viewer: "조회 전용",
};

export function roleLabel(role: UserRole | undefined | null): string {
  if (!role) return "—";
  return ROLE_LABELS[role] ?? role;
}

export type UserRole =
  | "super_admin"
  | "hq_admin"
  | "branch_owner"
  | "branch_manager"
  | "coach"
  | "member"
  // Phase B 멀티테넌트 역할 확장
  | "owner"
  | "brand_manager"
  | "staff"
  | "accountant"
  | "viewer";

export interface Profile {
  id: string;
  auth_user_id: string | null;
  role: UserRole;
  company_id: string | null;
  branch_id: string | null;
  name: string;
  phone: string | null;
  status: string;
  created_at: string;
}

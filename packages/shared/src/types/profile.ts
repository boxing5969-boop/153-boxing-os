export type UserRole =
  | "super_admin"
  | "hq_admin"
  | "branch_owner"
  | "branch_manager"
  | "coach"
  | "member";

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

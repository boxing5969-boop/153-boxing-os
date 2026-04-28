import { supabase } from "@/integrations/supabase/client";
import type { UserRole } from "@153/shared";

export interface StaffRow {
  id: string;
  auth_user_id: string | null;
  role: UserRole;
  branch_id: string | null;
  branch_name: string | null;
  company_id: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  status: string;
  created_at: string;
}

export async function listStaff(): Promise<StaffRow[]> {
  const { data, error } = await supabase.rpc("list_staff_profiles");
  if (error) throw error;
  return (data ?? []) as unknown as StaffRow[];
}

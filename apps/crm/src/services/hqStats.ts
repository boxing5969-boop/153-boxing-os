import { getAuthHeaders, API_URL } from "./api";

export interface BranchStat {
  branch_id:      string;
  branch_name:    string;
  active_members: number;
  today_access:   number;
  today_denied:   number;
  expiring_7d:    number;
  unpaid_members: number;
  failed_sync:    number;
}

export async function getHqStats(): Promise<BranchStat[]> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_URL}/api/admin/hq-stats`, { headers });
  const json = await res.json() as { success: boolean; data: BranchStat[]; message?: string };
  if (!json.success) throw new Error(json.message ?? "오류 발생");
  return json.data;
}

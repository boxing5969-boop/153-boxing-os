/**
 * 지점 직원 가입 승인 (본사 전용) — 별도 153-branch-report 앱 흡수
 * 워커 /api/branch-app/pending · /decide 를 153os CRM 에서 직접 처리한다.
 */
import { API_URL, getAuthHeaders } from "@/services/api";

export interface PendingSignup {
  id: string;
  name: string;
  role: string;
  created_at: string;
  branch_name: string | null;
}

export async function getPendingApprovals(): Promise<PendingSignup[]> {
  const res = await fetch(`${API_URL}/api/branch-app/pending`, {
    headers: await getAuthHeaders(),
  });
  const json = (await res.json().catch(() => null)) as
    | { success: boolean; data?: { pending: PendingSignup[] }; message?: string }
    | null;
  if (!res.ok || !json?.success) throw new Error(json?.message ?? "가입 신청을 불러오지 못했습니다");
  return json.data?.pending ?? [];
}

export async function decideApproval(
  profileId: string,
  action: "approve" | "reject",
): Promise<void> {
  const res = await fetch(`${API_URL}/api/branch-app/decide`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify({ profile_id: profileId, action }),
  });
  const json = (await res.json().catch(() => null)) as
    | { success: boolean; message?: string }
    | null;
  if (!res.ok || !json?.success) throw new Error(json?.message ?? "처리에 실패했습니다");
}

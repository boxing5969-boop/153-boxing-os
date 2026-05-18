import { supabase } from "@/integrations/supabase/client";

const baseUrl = import.meta.env.VITE_API_BASE_URL as string;

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function postApi<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: await authHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json() as { success: boolean; data: T; message?: string; error?: { message?: string } };
  if (!res.ok || !json.success) {
    throw new Error(json.error?.message ?? json.message ?? `HTTP ${res.status}`);
  }
  return json.data;
}

export interface SendReport {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  details: Array<{
    member_name: string;
    member_phone: string | null;
    status: "sent" | "failed" | "skipped";
    error?: string;
  }>;
}

/** 오늘의 자동 알림 대상 즉시 실행 */
export async function runNotificationsNow(): Promise<SendReport> {
  return postApi<SendReport>("/api/admin/kakao/run-now");
}

/** 회원 개별 만료 알림 발송 */
export async function sendMemberNotification(memberId: string): Promise<{
  member_name: string;
  member_phone: string | null;
  notification_type: string;
}> {
  return postApi(`/api/admin/members/${memberId}/notify`);
}

export interface BulkNotifyParams {
  days_ahead: number;
  branch_id?: string;
  dry_run?: boolean;
}

export interface BulkNotifyResult {
  targets_count: number;
  report?: SendReport;
}

/** 그룹 발송 */
export async function runBulkNotify(params: BulkNotifyParams): Promise<BulkNotifyResult> {
  return postApi<BulkNotifyResult>("/api/admin/notify/bulk", params);
}

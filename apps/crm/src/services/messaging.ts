/**
 * CRM ↔ Workers 메시징 API 서비스
 */
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

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: await authHeaders(),
    ...opts,
  });
  const json = await res.json() as { success: boolean; data: T; message?: string; error?: { message?: string } };
  if (!res.ok || !json.success) throw new Error(json.error?.message ?? json.message ?? `HTTP ${res.status}`);
  return json.data;
}

export type MsgChannel = "sms" | "kakao" | "both" | "kakao_sms_fallback";

// ── 메시지 템플릿 ─────────────────────────────────────────

export interface MessageTemplate {
  id: string;
  branch_id: string;
  name: string;
  content: string;
  channel: MsgChannel;
  trigger_type: string | null;
  is_active: boolean;
  created_at: string;
}

export async function listTemplates(branchId: string): Promise<MessageTemplate[]> {
  const { data, error } = await supabase
    .from("message_templates")
    .select("*")
    .eq("branch_id", branchId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as MessageTemplate[];
}

export async function createTemplate(input: Omit<MessageTemplate, "id" | "created_at">): Promise<MessageTemplate> {
  const { data, error } = await supabase
    .from("message_templates")
    .insert(input)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as MessageTemplate;
}

export async function updateTemplate(id: string, patch: Partial<Pick<MessageTemplate, "name" | "content" | "channel" | "trigger_type" | "is_active">>): Promise<void> {
  const { error } = await supabase
    .from("message_templates")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase.from("message_templates").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ── 예약 발송 ─────────────────────────────────────────────

export interface ScheduledMessage {
  id: string;
  branch_id: string;
  name: string;
  content: string;
  channel: MsgChannel;
  target_type: "member" | "group";
  target_member_id: string | null;
  target_days_ahead: number | null;
  scheduled_at: string;
  status: "pending" | "processing" | "sent" | "failed" | "cancelled";
  sent_count: number;
  fail_count: number;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
}

export async function listScheduledMessages(branchId: string): Promise<ScheduledMessage[]> {
  const { data, error } = await supabase
    .from("scheduled_messages")
    .select("*")
    .eq("branch_id", branchId)
    .order("scheduled_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ScheduledMessage[];
}

export async function createScheduledMessage(input: {
  branch_id: string;
  name: string;
  content: string;
  channel: MsgChannel;
  target_type: "member" | "group";
  target_member_id?: string;
  target_days_ahead?: number;
  scheduled_at: string;
}): Promise<ScheduledMessage> {
  const { data, error } = await supabase
    .from("scheduled_messages")
    .insert(input)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as ScheduledMessage;
}

export async function cancelScheduledMessage(id: string): Promise<void> {
  const { error } = await supabase
    .from("scheduled_messages")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
}

// ── 발송 이력 ──────────────────────────────────────────────

export interface MessageSendLog {
  id: string;
  branch_id: string | null;
  member_id: string | null;
  channel: "sms" | "kakao";
  recipient_phone: string | null;
  content_preview: string | null;
  trigger_type: string | null;
  status: "sent" | "failed";
  error_message: string | null;
  sent_at: string;
  // joined
  member_name?: string | null;
}

export async function listMessageSendLogs(params: { branchId?: string; limit?: number } = {}): Promise<MessageSendLog[]> {
  let query = supabase
    .from("message_send_logs")
    .select("*, members(name)")
    .order("sent_at", { ascending: false })
    .limit(params.limit ?? 200);

  if (params.branchId) query = query.eq("branch_id", params.branchId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown[]).map((r: unknown) => {
    const row = r as MessageSendLog & { members?: { name: string } | null };
    return { ...row, member_name: row.members?.name ?? null };
  });
}

// ── 지점 알림 설정 ─────────────────────────────────────────

export interface BranchNotifySettings {
  notify_channel: MsgChannel;
  notify_triggers: string[];
  sms_sender_phone: string | null;
}

export async function getBranchNotifySettings(branchId: string): Promise<BranchNotifySettings | null> {
  const { data, error } = await supabase
    .from("branches")
    .select("notify_channel,notify_triggers,sms_sender_phone")
    .eq("id", branchId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as BranchNotifySettings | null;
}

export async function saveBranchNotifySettings(branchId: string, settings: Partial<BranchNotifySettings>): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`${baseUrl}/api/admin/branches/${branchId}/notify-settings`, {
    method: "PUT",
    headers,
    body: JSON.stringify(settings),
  });
  const json = await res.json() as { success: boolean; error?: { message?: string } };
  if (!res.ok || !json.success) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
}

// ── 수동 발송 (채널 선택 포함) ──────────────────────────────

/** info = 정보성 공지(동의·시간 제약 없음), ad = 광고성(마케팅 동의자 + 08~21시) */
export type MsgType = "info" | "ad";

export interface ManualSendParams {
  member_id: string;
  channel: MsgChannel;
  content?: string;
  message_type?: MsgType;
}

export async function sendMemberMsg(params: ManualSendParams): Promise<{ success: boolean; message: string }> {
  return apiFetch(`/api/admin/members/${params.member_id}/send`, {
    method: "POST",
    body: JSON.stringify({
      channel: params.channel,
      content: params.content,
      message_type: params.message_type ?? "ad",
    }),
  });
}

export interface BulkSendParams {
  days_ahead: number;
  channel: MsgChannel;
  content?: string;
  branch_id?: string;
  dry_run?: boolean;
  survey_url?: string; // #{설문링크} 치환용
}

export interface BulkSendResult {
  targets_count: number;
  /** dispatchToGroup 결과 — Workers /notify/bulk-msg·/broadcast 응답 형식 */
  report?: { total: number; success: number; failed: number };
}

export async function sendBulkMsg(params: BulkSendParams): Promise<BulkSendResult> {
  return apiFetch("/api/admin/notify/bulk-msg", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ── 회원 공지 발송 (상태 기반 전체 발송) ──────────────────────
export interface BroadcastParams {
  channel: MsgChannel;
  content: string;
  target_statuses?: string[];
  branch_id?: string;
  dry_run?: boolean;
  survey_url?: string; // #{설문링크} 치환용
  message_type?: MsgType;
}

export async function broadcastMsg(params: BroadcastParams): Promise<BulkSendResult> {
  return apiFetch("/api/admin/notify/broadcast", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

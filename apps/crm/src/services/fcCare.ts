/**
 * FC AI Care Center 서비스 — 3차
 * - FC 업무함: tasks(업무카드) + message_suggestions(메시지 초안)
 * - 매출 기회 보드: member_status_snapshots(재등록·PT전환·추천 점수)
 * RLS 가 지점 단위 접근을 통제하므로 별도 RPC 없이 테이블을 직접 조회한다.
 * 메시지 "승인"은 status 를 approved 로 바꿀 뿐, 실제 발송은 하지 않는다.
 */
import { supabase } from "@/integrations/supabase/client";

// ── 업무카드 ──────────────────────────────────────────────────
export type TaskPriority = "low" | "normal" | "high" | "urgent";
export type TaskStatus = "open" | "in_progress" | "done" | "cancelled";

export interface FcTask {
  id: string;
  branch_id: string;
  member_id: string | null;
  member_name: string | null;
  task_type: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string | null;
  reason: string | null;
  recommended_action: string | null;
  recommended_message: string | null;
  expected_value: number | null;
  source_table: string | null;
  created_at: string;
}

const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0, high: 1, normal: 2, low: 3,
};

/** 처리 대기 FC 업무카드 (우선순위 → 마감일 순) */
export async function listFcTasks(): Promise<FcTask[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id,branch_id,member_id,task_type,title,description,priority,status," +
      "due_date,reason,recommended_action,recommended_message,expected_value," +
      "source_table,created_at,members(name)"
    )
    .in("status", ["open", "in_progress"])
    .is("deleted_at", null)
    .order("due_date", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as (Omit<FcTask, "member_name"> & {
    members: { name: string } | null;
  })[];
  return rows
    .map(({ members, ...rest }) => ({ ...rest, member_name: members?.name ?? null }))
    .sort((a, b) => {
      const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (p !== 0) return p;
      return (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");
    });
}

/** 업무 완료 처리 */
export async function completeTask(id: string): Promise<void> {
  const { error } = await supabase
    .from("tasks")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ── 메시지 초안 ───────────────────────────────────────────────
export interface SafetyFlag {
  type: string;
  term: string;
  severity: string;
}

export interface MessageDraft {
  id: string;
  member_id: string;
  member_name: string | null;
  channel: string | null;
  generated_body: string | null;
  generation_reason: string | null;
  status: string;
  safety_status: string;          // pass | warn | block
  safety_flags: SafetyFlag[];
  created_at: string;
}

/** 처리 대기(draft·approved) 메시지 초안 목록 */
export async function listMessageDrafts(): Promise<MessageDraft[]> {
  const { data, error } = await supabase
    .from("message_suggestions")
    .select(
      "id,member_id,channel,generated_body,generation_reason,status," +
      "safety_status,safety_flags,created_at,members(name)"
    )
    .in("status", ["draft", "approved"])
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as (Omit<MessageDraft, "member_name" | "safety_flags"> & {
    safety_flags: SafetyFlag[] | null;
    members: { name: string } | null;
  })[];
  return rows.map(({ members, safety_flags, ...rest }) => ({
    ...rest,
    safety_flags: safety_flags ?? [],
    member_name: members?.name ?? null,
  }));
}

/**
 * 메시지 초안 승인 — approve_message_suggestion RPC.
 * safety_status='block' 은 force=true + 조직 관리자만 통과.
 */
export async function approveMessageDraft(id: string, force = false): Promise<void> {
  const { data, error } = await supabase.rpc(
    "approve_message_suggestion" as "expire_outdated_memberships",
    { p_id: id, p_force: force } as unknown as Record<string, never>
  );
  if (error) throw new Error(error.message);
  const r = data as unknown as { success: boolean; error?: string };
  if (!r || !r.success) throw new Error(r?.error ?? "승인에 실패했습니다");
}

/** 메시지 초안 반려 */
export async function rejectMessageDraft(id: string): Promise<void> {
  const { error } = await supabase
    .from("message_suggestions")
    .update({ status: "rejected" })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ── 연락 기록 ─────────────────────────────────────────────────
export type ContactChannel = "kakao" | "sms" | "push" | "call" | "visit";
export type ContactResult =
  | "sent" | "no_answer" | "replied" | "booked"
  | "visited" | "renewed" | "pt_purchased" | "failed";

export interface ContactLogInput {
  branch_id: string;
  member_id: string;
  fc_task_id?: string | null;
  staff_id?: string | null;
  channel: ContactChannel;
  result: ContactResult;
  note?: string;
}

/** 연락 기록 추가 (append-only) */
export async function logContact(input: ContactLogInput): Promise<void> {
  const { error } = await supabase.from("contact_logs").insert(input);
  if (error) throw new Error(error.message);
}

// ── 매출 기회 보드 ────────────────────────────────────────────
export interface RevenueOpportunity {
  member_id: string;
  member_name: string | null;
  branch_id: string;
  product_type: string | null;
  lifecycle_stage: string | null;
  renewal_opportunity_score: number;
  pt_conversion_score: number;
  referral_potential_score: number;
  churn_risk_score: number;
  membership_expiry_date: string | null;
  days_until_expiry: number | null;
  pt_remaining_sessions: number | null;
  satisfaction_score: number | null;
}

/** 최신 스냅샷일의 회원 상태 — 매출 기회 보드용 */
export async function listRevenueOpportunities(): Promise<RevenueOpportunity[]> {
  // 가장 최근 스냅샷 날짜
  const { data: latest, error: latestErr } = await supabase
    .from("member_status_snapshots")
    .select("snapshot_date")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestErr) throw new Error(latestErr.message);
  const date = (latest as { snapshot_date: string } | null)?.snapshot_date;
  if (!date) return [];

  const { data, error } = await supabase
    .from("member_status_snapshots")
    .select(
      "member_id,branch_id,product_type,lifecycle_stage," +
      "renewal_opportunity_score,pt_conversion_score,referral_potential_score," +
      "churn_risk_score,membership_expiry_date,days_until_expiry," +
      "pt_remaining_sessions,satisfaction_score,members(name)"
    )
    .eq("snapshot_date", date);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as (Omit<RevenueOpportunity, "member_name"> & {
    members: { name: string } | null;
  })[];
  return rows.map(({ members, ...rest }) => ({
    ...rest,
    member_name: members?.name ?? null,
  }));
}

// ── Workers API (AI 생성 · 발송) ──────────────────────────────
const API_BASE = import.meta.env.VITE_API_BASE_URL as string;

async function fcApi<T>(path: string, body: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {}),
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    success: boolean; data: T; error?: { message?: string }; message?: string;
  };
  if (!res.ok || !json.success) {
    throw new Error(json.error?.message ?? json.message ?? `HTTP ${res.status}`);
  }
  return json.data;
}

export interface GenerateResult {
  text: string;
  mode: "llm" | "rule";
  safety_status: string;
}

/** AI 메시지 재생성 (LLM 우선·규칙 폴백) — 본문이 갱신됨 */
export async function regenerateMessage(suggestionId: string): Promise<GenerateResult> {
  return fcApi<GenerateResult>("/api/fc/generate-message", {
    suggestion_id: suggestionId,
  });
}

/** 승인된 메시지 발송 (SMS) */
export async function sendApprovedMessage(suggestionId: string): Promise<void> {
  await fcApi<{ sent: boolean }>("/api/fc/send-message", {
    suggestion_id: suggestionId,
  });
}

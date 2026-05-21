/**
 * FC AI Care Center 라우트
 * Base: /api/fc
 * - POST /generate-message : 회원 맥락으로 메시지 초안 생성(LLM·폴백) 후 저장
 * - POST /send-message     : 승인된 메시지 초안을 SMS로 발송 + 연락기록
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../lib/env";
import { fail, ok } from "../lib/responses";
import { requireJwt } from "../middleware/jwt";
import { getServiceClient } from "../lib/supabase";
import { generateFcMessage } from "../services/fcMessageGen";
import { sendSms } from "../services/smsNotifier";

export const fcRoutes = new Hono<{ Bindings: Env }>();

const HQ = new Set(["super_admin", "hq_admin"]);

interface Caller {
  id: string;
  role: string;
  company_id: string | null;
  branch_id: string | null;
}

async function loadCaller(env: Env, userId: string): Promise<Caller | null> {
  const { data } = await getServiceClient(env)
    .from("profiles")
    .select("id,role,company_id,branch_id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  return (data as Caller | null) ?? null;
}

function canAccessBranch(caller: Caller, branchId: string): boolean {
  if (HQ.has(caller.role)) return true;
  return caller.branch_id === branchId;
}

interface SuggestionRow {
  id: string;
  branch_id: string;
  member_id: string;
  fc_task_id: string | null;
  generated_body: string | null;
  channel: string | null;
  status: string;
  safety_status: string;
}

async function loadSuggestion(
  env: Env, id: string,
): Promise<SuggestionRow | null> {
  const { data } = await getServiceClient(env)
    .from("message_suggestions")
    .select("id,branch_id,member_id,fc_task_id,generated_body,channel,status,safety_status")
    .eq("id", id)
    .maybeSingle();
  return (data as SuggestionRow | null) ?? null;
}

// ── POST /api/fc/generate-message ────────────────────────────
const genSchema = z.object({ suggestion_id: z.string().uuid() });

fcRoutes.post("/generate-message", requireJwt, async (c) => {
  const parsed = genSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "BAD_REQUEST", "suggestion_id 필요", 400);

  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);

  const sug = await loadSuggestion(c.env, parsed.data.suggestion_id);
  if (!sug) return fail(c, "NOT_FOUND", "메시지를 찾을 수 없음", 404);
  if (!canAccessBranch(caller, sug.branch_id)) {
    return fail(c, "PERMISSION_DENIED", "접근 권한 없음", 403);
  }
  if (sug.status !== "draft") {
    return fail(c, "INVALID_STATE", "초안 상태에서만 재생성할 수 있습니다", 422);
  }

  const db = getServiceClient(c.env);

  // 회원·지점·스냅샷 맥락 수집
  const { data: member } = await db
    .from("members")
    .select("name,branch_id,branches(name)")
    .eq("id", sug.member_id)
    .maybeSingle();
  const m = member as { name: string; branches: { name: string } | null } | null;

  const { data: snap } = await db
    .from("member_status_snapshots")
    .select("product_type,lifecycle_stage,days_since_last_visit,days_until_expiry")
    .eq("member_id", sug.member_id)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const s = snap as {
    product_type: string | null; lifecycle_stage: string | null;
    days_since_last_visit: number | null; days_until_expiry: number | null;
  } | null;

  const gen = await generateFcMessage(c.env, {
    member_name: m?.name ?? "회원",
    branch_name: m?.branches?.name ?? "센터",
    product_type: s?.product_type,
    lifecycle_stage: s?.lifecycle_stage,
    days_since_last_visit: s?.days_since_last_visit,
    days_until_expiry: s?.days_until_expiry,
  });

  // 본문 저장 — 안전검증 트리거가 safety_status 를 재계산
  const { error: upErr } = await db
    .from("message_suggestions")
    .update({ generated_body: gen.text })
    .eq("id", sug.id);
  if (upErr) return fail(c, "DB_ERROR", upErr.message, 500);

  const after = await loadSuggestion(c.env, sug.id);
  return ok(c, {
    text: gen.text,
    mode: gen.mode,
    safety_status: after?.safety_status ?? "pass",
  });
});

// ── POST /api/fc/send-message ────────────────────────────────
const sendSchema = z.object({ suggestion_id: z.string().uuid() });

fcRoutes.post("/send-message", requireJwt, async (c) => {
  const parsed = sendSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "BAD_REQUEST", "suggestion_id 필요", 400);

  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);

  const sug = await loadSuggestion(c.env, parsed.data.suggestion_id);
  if (!sug) return fail(c, "NOT_FOUND", "메시지를 찾을 수 없음", 404);
  if (!canAccessBranch(caller, sug.branch_id)) {
    return fail(c, "PERMISSION_DENIED", "접근 권한 없음", 403);
  }
  if (sug.status !== "approved") {
    return fail(c, "INVALID_STATE", "승인된 메시지만 발송할 수 있습니다", 422);
  }
  if (sug.safety_status === "block") {
    return fail(c, "SAFETY_BLOCKED", "안전 검증을 통과하지 못한 메시지입니다", 422);
  }
  if (!sug.generated_body || !sug.generated_body.trim()) {
    return fail(c, "INVALID_STATE", "메시지 본문이 비어 있습니다", 422);
  }

  const db = getServiceClient(c.env);

  const { data: member } = await db
    .from("members")
    .select("phone")
    .eq("id", sug.member_id)
    .maybeSingle();
  const phone = (member as { phone: string | null } | null)?.phone;
  if (!phone) return fail(c, "INVALID_STATE", "회원 전화번호가 없습니다", 422);

  const result = await sendSms(db, c.env, sug.branch_id, phone, sug.generated_body);
  if (!result.success) {
    return fail(c, "SEND_FAILED", result.error ?? "발송 실패", 500);
  }

  // 발송 성공 — 상태 갱신 + 연락기록
  await db.from("message_suggestions")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", sug.id);

  await db.from("contact_logs").insert({
    branch_id: sug.branch_id,
    member_id: sug.member_id,
    fc_task_id: sug.fc_task_id,
    staff_id: caller.id,
    channel: "sms",
    message_body: sug.generated_body,
    result: "sent",
  });

  return ok(c, { sent: true });
});

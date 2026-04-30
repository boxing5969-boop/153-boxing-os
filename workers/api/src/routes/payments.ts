/**
 * 153os — 결제선생(Payssam) 청구서 발송 & 웹훅 수신
 *
 * POST /api/payments/send          — 청구서 발송 (JWT 인증 필요)
 * POST /api/payments/webhook       — 결제 완료 웹훅 (결제선생 → Workers)
 * GET  /api/payments/:member_id    — 회원 청구서 목록 (JWT 인증 필요)
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../lib/env";
import { fail, ok } from "../lib/responses";
import { getServiceClient } from "../lib/supabase";
import { requireJwt } from "../middleware/jwt";

export const paymentsRoutes = new Hono<{ Bindings: Env }>();

// ── 결제선생 API base URL (계약 후 정확한 URL 확인)
const PAYSSAM_API_BASE = "https://api.payssam.kr/v2";

// ── 호출자 프로필 로드 헬퍼
async function loadProfile(env: Env, authUserId: string) {
  const db = getServiceClient(env);
  const { data } = await db
    .from("profiles")
    .select("id, role, company_id, branch_id, auth_user_id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  return data as {
    id: string;
    role: string;
    company_id: string | null;
    branch_id: string | null;
    auth_user_id: string;
  } | null;
}

// ── 청구서 발송 스키마
const sendBillSchema = z.object({
  member_id:       z.string().uuid(),
  membership_id:   z.string().uuid().optional(),
  amount:          z.number().int().positive(),
  description:     z.string().min(1).max(100),
  due_date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  recipient_phone: z.string().min(9).max(15),
  sent_via:        z.enum(["sms", "kakao", "both"]).default("sms"),
  trigger_type:    z.enum(["manual", "d7", "d3", "d1", "renewal"]).default("manual"),
});

// ── 1) 청구서 발송
paymentsRoutes.post("/send", requireJwt, async (c) => {
  const user = c.get("user");
  const profile = await loadProfile(c.env, user.id);
  if (!profile) return fail(c, "PROFILE_NOT_FOUND", "프로필을 찾을 수 없습니다.", 403);
  if (!profile.branch_id) return fail(c, "NO_BRANCH", "지점 정보가 없습니다.", 403);

  const body = await c.req.json().catch(() => null);
  const parsed = sendBillSchema.safeParse(body);
  if (!parsed.success) return fail(c, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "잘못된 요청입니다.", 400);

  const {
    member_id, membership_id, amount, description,
    due_date, recipient_phone, sent_via, trigger_type,
  } = parsed.data;

  const payssam_key = c.env.PAYSSAM_API_KEY;
  if (!payssam_key) return fail(c, "SERVICE_UNAVAILABLE", "결제선생 API 키가 설정되지 않았습니다.", 503);

  // ── 결제선생 청구서 발송 API 호출
  let payssam_bill_id: string | null = null;
  let payssam_bill_url: string | null = null;

  try {
    const res = await fetch(`${PAYSSAM_API_BASE}/bills`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${payssam_key}`,
      },
      body: JSON.stringify({
        amount,
        memo: description,
        phone: recipient_phone.replace(/-/g, ""),
        due_date: due_date ?? null,
        // 결제선생 API 실제 파라미터명은 계약 후 문서 확인 필요
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Payssam API error:", res.status, errText);
      return fail(c, "PAYSSAM_ERROR", "결제선생 청구서 발송에 실패했습니다.", 502);
    }

    const json = await res.json() as {
      bill_id?: string; bill_url?: string;
      id?: string; url?: string;
    };
    payssam_bill_id  = json.bill_id ?? json.id  ?? null;
    payssam_bill_url = json.bill_url ?? json.url ?? null;
  } catch (err) {
    console.error("Payssam fetch error:", err);
    return fail(c, "PAYSSAM_UNREACHABLE", "결제선생 서버에 연결하지 못했습니다.", 502);
  }

  // ── DB에 기록
  const sb = getServiceClient(c.env);
  const { data, error } = await sb
    .from("payment_requests")
    .insert({
      branch_id:       profile.branch_id,
      member_id,
      membership_id:   membership_id ?? null,
      payssam_bill_id,
      payssam_bill_url,
      amount,
      description,
      due_date:        due_date ?? null,
      recipient_phone: recipient_phone.replace(/-/g, ""),
      sent_via,
      is_auto:         trigger_type !== "manual",
      trigger_type,
      created_by:      profile.auth_user_id,
    })
    .select("id, payssam_bill_url, status")
    .single();

  if (error) {
    console.error("DB insert error:", error);
    return fail(c, "DB_ERROR", "청구서 내역 저장에 실패했습니다.", 500);
  }

  return ok(c, {
    payment_request_id: data.id,
    bill_url:           data.payssam_bill_url,
    status:             data.status,
  });
});

// ── 2) 결제 완료 웹훅 (결제선생 → 153os Workers)
paymentsRoutes.post("/webhook", async (c) => {
  // 결제선생 웹훅 서명 검증 (계약 후 실제 서명 방식 확인 필요)
  const webhookSecret = c.env.PAYSSAM_WEBHOOK_SECRET;
  if (webhookSecret) {
    const signature = c.req.header("x-payssam-signature") ?? "";
    if (!signature) {
      console.warn("Payssam webhook: missing signature — skipping in dev");
      // 프로덕션: return fail(c, "UNAUTHORIZED", "Signature missing", 401)
    }
    // TODO: HMAC-SHA256 검증 구현 (결제선생 문서 확인 후)
  }

  const body = await c.req.json().catch(() => null);
  if (!body) return fail(c, "INVALID_BODY", "invalid body", 400);

  // 결제선생 웹훅 payload (계약 후 정확한 필드명 확인)
  const bill_id: string | undefined =
    (body as Record<string, string>).bill_id ??
    (body as Record<string, string>).billId ??
    (body as Record<string, string>).id;

  const paid_at: string | undefined =
    (body as Record<string, string>).paid_at ??
    (body as Record<string, string>).paidAt ??
    (body as Record<string, string>).payment_date;

  if (!bill_id) return fail(c, "MISSING_BILL_ID", "bill_id missing", 400);

  const sb = getServiceClient(c.env);
  const { error } = await sb.rpc("mark_payment_completed", {
    _payssam_bill_id: bill_id,
    _paid_at: paid_at
      ? new Date(paid_at).toISOString()
      : new Date().toISOString(),
  });

  if (error) {
    console.error("mark_payment_completed error:", error);
    return fail(c, "DB_ERROR", "DB update failed", 500);
  }

  return ok(c, { received: true });
});

// ── 3) 회원 청구서 목록
paymentsRoutes.get("/:member_id", requireJwt, async (c) => {
  const user = c.get("user");
  const profile = await loadProfile(c.env, user.id);
  if (!profile) return fail(c, "PROFILE_NOT_FOUND", "프로필을 찾을 수 없습니다.", 403);

  const member_id = c.req.param("member_id");
  const sb = getServiceClient(c.env);

  const { data, error } = await sb
    .from("payment_requests")
    .select("id, amount, description, status, payssam_bill_url, due_date, paid_at, sent_via, trigger_type, created_at")
    .eq("member_id", member_id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data);
});

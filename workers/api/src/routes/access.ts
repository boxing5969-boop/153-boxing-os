import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../lib/env";
import { fail, ok } from "../lib/responses";
import { requireDeviceAuth } from "../middleware/deviceAuth";
import { requireJwt } from "../middleware/jwt";
import { getServiceClient } from "../lib/supabase";
import { generateQrToken, verifyQrToken } from "../services/qrToken";
import { verifyAccess, type VerifyInput } from "../services/accessVerifier";
import { appendAccessLog } from "../services/auditLogger";
import { DENIED_REASON_LABELS, type DeniedReason } from "@153/shared";

export const accessRoutes = new Hono<{ Bindings: Env }>();

const verifySchema = z.object({
  branch_id: z.string().uuid(),
  device_id: z.string().uuid(),
  credential_type: z.enum(["face", "qr", "card", "pin", "admin", "visitor"]),
  credential_value: z.string().min(1),
  occurred_at: z.string(),
});

accessRoutes.post("/verify", requireDeviceAuth, async (c) => {
  const json = await c.req.json().catch(() => null);
  const parsed = verifySchema.safeParse(json);
  if (!parsed.success) {
    return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  }
  const input: VerifyInput = parsed.data;
  const db = getServiceClient(c.env);

  // QR 처리 — 토큰 검증 + nonce 재사용 체크
  let qrConsumed: { nonce: string; expires_at: number } | null = null;
  if (input.credential_type === "qr") {
    if (!c.env.QR_SIGNING_SECRET) {
      return fail(c, "INTERNAL_ERROR", "QR_SIGNING_SECRET not configured", 500);
    }
    const result = await verifyQrToken(c.env.QR_SIGNING_SECRET, input.credential_value);
    if (!result.ok) {
      const reason = result.reason as DeniedReason;
      const logId = await appendAccessLog(db, {
        branch_id: input.branch_id,
        device_id: input.device_id,
        member_id: null,
        credential_type: "qr",
        result: "denied",
        denied_reason: reason,
        occurred_at: input.occurred_at,
      });
      return ok(c, {
        door_open: false,
        denied_reason: reason,
        message: DENIED_REASON_LABELS[reason] ?? "QR 검증 실패",
        log_id: logId,
      });
    }
    const { data: used } = await db
      .from("qr_used_tokens")
      .select("nonce")
      .eq("nonce", result.payload.nonce)
      .maybeSingle();
    if (used) {
      const logId = await appendAccessLog(db, {
        branch_id: input.branch_id,
        device_id: input.device_id,
        member_id: result.payload.member_id,
        credential_type: "qr",
        result: "denied",
        denied_reason: "qr_already_used",
        occurred_at: input.occurred_at,
      });
      return ok(c, {
        door_open: false,
        denied_reason: "qr_already_used",
        message: DENIED_REASON_LABELS.qr_already_used,
        log_id: logId,
      });
    }
    qrConsumed = { nonce: result.payload.nonce, expires_at: result.payload.expires_at };
    input.credential_value = result.payload.member_id;
  }

  const decision = await verifyAccess(db, input, qrConsumed);

  if (decision.door_open) {
    const rawEventId = decision.pin_id
      ? `pin:${decision.pin_id}:issuer:${decision.pin_issuer ?? "unknown"}`
      : null;
    const logId = await appendAccessLog(db, {
      branch_id: input.branch_id,
      device_id: input.device_id,
      member_id: decision.member_id,
      credential_type: input.credential_type,
      result: "success",
      raw_event_id: rawEventId,
      occurred_at: input.occurred_at,
    });
    return ok(c, {
      door_open: true,
      member_id: decision.member_id,
      member_name: decision.member_name,
      message: "입장 승인",
      log_id: logId,
    });
  }

  const logId = await appendAccessLog(db, {
    branch_id: input.branch_id,
    device_id: input.device_id,
    member_id: decision.member_id,
    credential_type: input.credential_type,
    result: "denied",
    denied_reason: decision.reason,
    occurred_at: input.occurred_at,
  });
  return ok(c, {
    door_open: false,
    denied_reason: decision.reason,
    message: DENIED_REASON_LABELS[decision.reason] ?? "출입 거절",
    log_id: logId,
  });
});

const qrGenSchema = z.object({
  member_id: z.string().uuid(),
  branch_id: z.string().uuid(),
});

accessRoutes.post("/qr/generate", requireJwt, async (c) => {
  const json = await c.req.json().catch(() => null);
  const parsed = qrGenSchema.safeParse(json);
  if (!parsed.success) {
    return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  }
  if (!c.env.QR_SIGNING_SECRET) {
    return fail(c, "INTERNAL_ERROR", "QR_SIGNING_SECRET not configured", 500);
  }
  const { token, expires_at } = await generateQrToken(
    c.env.QR_SIGNING_SECRET,
    parsed.data.member_id,
    parsed.data.branch_id
  );
  return ok(c, {
    qr_token: token,
    expires_at: new Date(expires_at * 1000).toISOString(),
    ttl_seconds: 60,
  });
});

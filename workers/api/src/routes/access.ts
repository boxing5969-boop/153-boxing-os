import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../lib/env";
import { fail, ok } from "../lib/responses";
import { requireDeviceAuth } from "../middleware/deviceAuth";
import { requireJwt } from "../middleware/jwt";
import { getServiceClient } from "../lib/supabase";
import { generateQrToken, verifyQrToken } from "../services/qrToken";
import { verifyAccess, type VerifyInput } from "../services/accessVerifier";
import { previewAccessForMember } from "../services/accessPreview";
import { appendAccessLog } from "../services/auditLogger";
import { DENIED_REASON_LABELS, type DeniedReason } from "@153/shared";

export const accessRoutes = new Hono<{ Bindings: Env }>();

const HQ_ROLES = new Set(["super_admin", "hq_admin"]);
const BRANCH_ROLES = new Set(["branch_manager", "branch_owner", "coach", "staff"]);

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

// 회원 1명에 대한 출입 가능 여부 미리보기 (side-effect 없음, JWT 인증)
const previewQuerySchema = z.object({
  member_id: z.string().uuid(),
  branch_id: z.string().uuid().optional(),
});

accessRoutes.get("/preview", requireJwt, async (c) => {
  const parsed = previewQuerySchema.safeParse({
    member_id: c.req.query("member_id"),
    branch_id: c.req.query("branch_id"),
  });
  if (!parsed.success) {
    return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid query", 400);
  }
  const { member_id, branch_id } = parsed.data;

  const user = c.get("user");
  const db = getServiceClient(c.env);

  const { data: profileRaw } = await db
    .from("profiles")
    .select("id,role,company_id,branch_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const profile = profileRaw as
    | { id: string; role: string; company_id: string | null; branch_id: string | null }
    | null;
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다.", 403);
  if (!HQ_ROLES.has(profile.role) && !BRANCH_ROLES.has(profile.role)) {
    return fail(c, "FORBIDDEN", "권한이 없습니다.", 403);
  }

  const { data: memberRaw } = await db
    .from("members")
    .select("id,branch_id,company_id")
    .eq("id", member_id)
    .maybeSingle();
  const member = memberRaw as { id: string; branch_id: string; company_id: string } | null;
  if (!member) return fail(c, "NOT_FOUND", "회원을 찾을 수 없습니다.", 404);

  // 본사 권한이면 같은 company 만, 지점 권한이면 같은 branch 만
  if (HQ_ROLES.has(profile.role)) {
    if (profile.company_id && profile.company_id !== member.company_id) {
      return fail(c, "FORBIDDEN", "다른 회사의 회원입니다.", 403);
    }
  } else {
    if (!profile.branch_id || profile.branch_id !== member.branch_id) {
      return fail(c, "FORBIDDEN", "다른 지점의 회원입니다.", 403);
    }
  }

  // branch_id 가 명시되면 회원 소속과 일치해야 함
  if (branch_id && branch_id !== member.branch_id) {
    return fail(c, "FORBIDDEN", "해당 지점 소속 회원이 아닙니다.", 403);
  }

  const decision = await previewAccessForMember(db, member.id, branch_id ?? member.branch_id);

  if (decision.allowed) {
    return ok(c, {
      allowed: true,
      member_id: decision.member_id,
      member_name: decision.member_name,
      source: decision.source,
    });
  }
  const reason: DeniedReason = decision.reason;
  return ok(c, {
    allowed: false,
    member_id: decision.member_id,
    reason,
    message: DENIED_REASON_LABELS[reason] ?? "출입 불가",
  });
});

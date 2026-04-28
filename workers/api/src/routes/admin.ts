import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../lib/env";
import { fail, ok } from "../lib/responses";
import { requireJwt } from "../middleware/jwt";
import { getServiceClient } from "../lib/supabase";
import { appendAccessLog } from "../services/auditLogger";

export const adminRoutes = new Hono<{ Bindings: Env }>();

const doorOpenSchema = z.object({
  device_id: z.string().uuid(),
  reason: z.string().min(1, "사유 입력 필수"),
});

const ALLOWED_ROLES = new Set(["super_admin", "hq_admin", "branch_owner"]);

adminRoutes.post("/door/open", requireJwt, async (c) => {
  const parsed = doorOpenSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  }
  const db = getServiceClient(c.env);
  const user = c.get("user");

  const { data: profileRaw } = await db
    .from("profiles")
    .select("id,role,branch_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const profile = profileRaw as { id: string; role: string; branch_id: string | null } | null;

  if (!profile) {
    return fail(c, "PERMISSION_DENIED", "프로필을 찾을 수 없습니다", 403);
  }
  if (!ALLOWED_ROLES.has(profile.role)) {
    return fail(c, "PERMISSION_DENIED", "원격 오픈 권한이 없습니다", 403);
  }

  const { data: deviceRaw } = await db
    .from("access_devices")
    .select("id,branch_id,vendor")
    .eq("id", parsed.data.device_id)
    .maybeSingle();
  const device = deviceRaw as { id: string; branch_id: string; vendor: string } | null;
  if (!device) {
    return fail(c, "DEVICE_NOT_FOUND", "Device not found", 404);
  }

  if (profile.role === "branch_owner" && profile.branch_id !== device.branch_id) {
    return fail(c, "PERMISSION_DENIED", "다른 지점의 단말기는 제어할 수 없습니다", 403);
  }

  // 실제 device adapter.openDoor() 호출은 Phase 7 (Mock) / Phase 8 (Suprema) 에서 통합
  // Phase 4 에서는 audit log 만 기록하고 성공 응답
  const occurredAt = new Date().toISOString();
  const logId = await appendAccessLog(db, {
    branch_id: device.branch_id,
    device_id: device.id,
    member_id: null, // members FK 라 admin 의 profile.id 는 member_id 컬럼에 못 들어감
    credential_type: "admin",
    result: "success",
    raw_event_id: `admin:${profile.id}:${parsed.data.reason.slice(0, 80)}`,
    occurred_at: occurredAt,
  });

  return ok(
    c,
    {
      log_id: logId,
      device_id: device.id,
      opened_at: occurredAt,
      reason: parsed.data.reason,
    },
    "문이 열렸습니다"
  );
});


// ── Branch Kakao AlimTalk settings ──────────────────────────
const kakaoSettingsSchema = z.object({
  kakao_pfid:           z.string().min(1),
  kakao_sender_phone:   z.string().min(1),
  kakao_tpl_d7:         z.string().optional(),
  kakao_tpl_d3:         z.string().optional(),
  kakao_tpl_d1:         z.string().optional(),
  kakao_api_key:        z.string().optional(),   // plain -- encrypted on save
  kakao_api_secret:     z.string().optional(),   // plain -- encrypted on save
  kakao_enabled:        z.boolean().default(false),
});

const HQ_AND_BRANCH = new Set(["super_admin", "hq_admin", "branch_admin", "branch_owner"]);

adminRoutes.put("/branches/:id/kakao", requireJwt, async (c) => {
  const branchId = c.req.param("id");
  const parsed = kakaoSettingsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  }

  const db = getServiceClient(c.env);
  const user = c.get("user");

  const { data: profileRaw } = await db
    .from("profiles")
    .select("role, branch_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const profile = profileRaw as { role: string; branch_id: string | null } | null;
  if (!profile || !HQ_AND_BRANCH.has(profile.role)) {
    return fail(c, "PERMISSION_DENIED", "권한이 없습니다", 403);
  }
  // branch_admin can only update their own branch
  if ((profile.role === "branch_admin" || profile.role === "branch_owner") && profile.branch_id !== branchId) {
    return fail(c, "PERMISSION_DENIED", "다른 지점 설정을 변경할 수 없습니다", 403);
  }

  const { encryptDeviceKey } = await import("../lib/keyEncryption");
  const kmsKey = c.env.DEVICE_KMS_KEY;

  let apiKeyEnc: string | undefined;
  let apiSecretEnc: string | undefined;

  if (parsed.data.kakao_api_key && kmsKey) {
    apiKeyEnc = await encryptDeviceKey(kmsKey, parsed.data.kakao_api_key);
  }
  if (parsed.data.kakao_api_secret && kmsKey) {
    apiSecretEnc = await encryptDeviceKey(kmsKey, parsed.data.kakao_api_secret);
  }

  const { error } = await db.from("branches").update({
    kakao_pfid:            parsed.data.kakao_pfid,
    kakao_sender_phone:    parsed.data.kakao_sender_phone,
    kakao_tpl_d7:          parsed.data.kakao_tpl_d7 ?? null,
    kakao_tpl_d3:          parsed.data.kakao_tpl_d3 ?? null,
    kakao_tpl_d1:          parsed.data.kakao_tpl_d1 ?? null,
    kakao_api_key_enc:     apiKeyEnc,
    kakao_api_secret_enc:  apiSecretEnc,
    kakao_enabled:         parsed.data.kakao_enabled,
  }).eq("id", branchId);

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { branch_id: branchId }, "카카오 알림톡 설정이 저장되었습니다");
});

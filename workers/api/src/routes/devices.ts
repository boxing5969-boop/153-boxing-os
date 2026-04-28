import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../lib/env";
import { fail, ok } from "../lib/responses";
import { requireJwt } from "../middleware/jwt";
import { requireDeviceAuth } from "../middleware/deviceAuth";
import { getServiceClient } from "../lib/supabase";
import { appendAccessLog } from "../services/auditLogger";
import {
  encryptDeviceKey,
  fingerprintKey,
  generateRandomKey,
} from "../lib/keyEncryption";

export const devicesRoutes = new Hono<{ Bindings: Env }>();

const HQ_ROLES = new Set(["super_admin", "hq_admin"]);

interface ProfileRow {
  id: string;
  role: string;
  branch_id: string | null;
}

async function loadCallerProfile(c: {
  env: Env;
  get: (key: "user") => { id: string };
}): Promise<ProfileRow | null> {
  const user = c.get("user");
  const db = getServiceClient(c.env);
  const { data } = await db
    .from("profiles")
    .select("id,role,branch_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  return (data as ProfileRow | null) ?? null;
}

const syncSchema = z.object({
  member_id: z.string().uuid(),
  action: z.enum(["create", "update", "disable", "delete"]),
});

devicesRoutes.post("/sync-member", requireJwt, async (c) => {
  const parsed = syncSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  }
  const db = getServiceClient(c.env);

  const { data: deviceUsersRaw } = await db
    .from("device_users")
    .select("device_id,vendor_user_id")
    .eq("member_id", parsed.data.member_id);
  const deviceUsers = (deviceUsersRaw ?? []) as { device_id: string; vendor_user_id: string }[];

  if (deviceUsers.length === 0) {
    return ok(c, { sync_jobs_created: 0, job_ids: [] }, "단말기 매핑이 없습니다");
  }

  const jobTypeMap: Record<string, string> = {
    create: "create_user",
    update: "update_user",
    disable: "disable_user",
    delete: "delete_user",
  };

  const { data: deviceRowsRaw } = await db
    .from("access_devices")
    .select("id,branch_id")
    .in(
      "id",
      deviceUsers.map((d) => d.device_id)
    );
  const deviceRows = (deviceRowsRaw ?? []) as { id: string; branch_id: string }[];

  const jobs = deviceRows.map((d) => ({
    branch_id: d.branch_id,
    device_id: d.id,
    job_type: jobTypeMap[parsed.data.action],
    target_member_id: parsed.data.member_id,
    status: "pending",
  }));

  if (jobs.length === 0) {
    return ok(c, { sync_jobs_created: 0, job_ids: [] }, "매핑된 단말기가 없습니다");
  }

  const { data: insertedRaw, error } = await db
    .from("device_sync_jobs")
    .insert(jobs)
    .select("id");
  if (error) {
    return fail(c, "INTERNAL_ERROR", error.message, 500);
  }
  const inserted = (insertedRaw ?? []) as { id: string }[];
  return ok(
    c,
    {
      sync_jobs_created: inserted.length,
      job_ids: inserted.map((j) => j.id),
    },
    "동기화 작업이 큐에 등록되었습니다"
  );
});

const webhookSchema = z.object({
  device_id: z.string().uuid(),
  events: z
    .array(
      z.object({
        vendor_event_id: z.string(),
        vendor_user_id: z.string(),
        event_type: z.enum(["face_match", "card_swipe", "door_open", "denied"]),
        occurred_at: z.string(),
        raw: z.record(z.unknown()).default({}),
      })
    )
    .min(1)
    .max(100),
});

devicesRoutes.post("/webhook", requireDeviceAuth, async (c) => {
  const parsed = webhookSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  }
  const db = getServiceClient(c.env);

  const { data: deviceRaw } = await db
    .from("access_devices")
    .select("id,branch_id")
    .eq("id", parsed.data.device_id)
    .maybeSingle();
  const device = deviceRaw as { id: string; branch_id: string } | null;
  if (!device) {
    return fail(c, "DEVICE_NOT_FOUND", "Device not found", 404);
  }

  let accepted = 0;
  for (const evt of parsed.data.events) {
    const { data: duRaw } = await db
      .from("device_users")
      .select("member_id")
      .eq("device_id", device.id)
      .eq("vendor_user_id", evt.vendor_user_id)
      .maybeSingle();
    const du = duRaw as { member_id: string } | null;

    const result = evt.event_type === "denied" ? "denied" : "success";
    const credential = evt.event_type === "card_swipe" ? "card" : "face";
    const logId = await appendAccessLog(db, {
      branch_id: device.branch_id,
      device_id: device.id,
      member_id: du?.member_id ?? null,
      credential_type: credential,
      result,
      raw_event_id: evt.vendor_event_id,
      occurred_at: evt.occurred_at,
    });
    if (logId) accepted++;
  }

  return ok(c, { accepted, total: parsed.data.events.length });
});

// ============================================================
// Phase 9 — 단말기 등록 + 키 회전 (Workers DEVICE_KMS_KEY 로 암호화)
// ============================================================

const registerSchema = z.object({
  branch_id: z.string().uuid(),
  device_name: z.string().min(1).max(100),
  device_type: z.enum(["face_terminal", "qr_reader", "card_reader", "relay", "kiosk"]),
  vendor: z.enum(["suprema", "zkteco", "hikvision", "mock", "custom", "other"]),
  device_identifier: z.string().max(200).optional(),
  model_name: z.string().max(200).optional(),
  api_endpoint: z.string().url().optional(),
});

devicesRoutes.post("/register", requireJwt, async (c) => {
  const parsed = registerSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  }
  if (!c.env.DEVICE_KMS_KEY) {
    return fail(c, "INTERNAL_ERROR", "DEVICE_KMS_KEY not configured", 500);
  }

  const profile = await loadCallerProfile(c);
  if (!profile) return fail(c, "PERMISSION_DENIED", "프로필을 찾을 수 없습니다", 403);

  const isHq = HQ_ROLES.has(profile.role);
  const isOwnerOfBranch =
    profile.role === "branch_owner" && profile.branch_id === parsed.data.branch_id;
  if (!isHq && !isOwnerOfBranch) {
    return fail(c, "PERMISSION_DENIED", "장비 등록 권한이 없습니다", 403);
  }

  const apiKey = generateRandomKey(32);
  const apiKeyEncrypted = await encryptDeviceKey(c.env.DEVICE_KMS_KEY, apiKey);
  const apiKeyFingerprint = fingerprintKey(apiKey);

  const db = getServiceClient(c.env);
  const { data: insertedRaw, error } = await db
    .from("access_devices")
    .insert({
      branch_id: parsed.data.branch_id,
      device_name: parsed.data.device_name,
      device_type: parsed.data.device_type,
      vendor: parsed.data.vendor,
      device_identifier: parsed.data.device_identifier ?? null,
      model_name: parsed.data.model_name ?? null,
      api_endpoint: parsed.data.api_endpoint ?? null,
      api_key_encrypted: apiKeyEncrypted,
      api_key_fingerprint: apiKeyFingerprint,
      status: "active",
    })
    .select("id")
    .single();
  if (error) return fail(c, "INTERNAL_ERROR", error.message, 500);

  const inserted = insertedRaw as { id: string };
  return ok(
    c,
    {
      device_id: inserted.id,
      api_key: apiKey,
      api_key_fingerprint: apiKeyFingerprint,
    },
    "장비가 등록되었습니다. api_key 는 다시 조회할 수 없으니 즉시 단말기에 입력하세요."
  );
});

devicesRoutes.post("/:id/rotate-key", requireJwt, async (c) => {
  const deviceId = c.req.param("id");
  if (!deviceId) return fail(c, "INVALID_REQUEST", "device id required", 400);
  if (!c.env.DEVICE_KMS_KEY) {
    return fail(c, "INTERNAL_ERROR", "DEVICE_KMS_KEY not configured", 500);
  }

  const profile = await loadCallerProfile(c);
  if (!profile) return fail(c, "PERMISSION_DENIED", "프로필을 찾을 수 없습니다", 403);

  const db = getServiceClient(c.env);
  const { data: deviceRaw } = await db
    .from("access_devices")
    .select("id,branch_id")
    .eq("id", deviceId)
    .maybeSingle();
  const device = deviceRaw as { id: string; branch_id: string } | null;
  if (!device) return fail(c, "DEVICE_NOT_FOUND", "Device not found", 404);

  const isHq = HQ_ROLES.has(profile.role);
  const isOwnerOfBranch =
    profile.role === "branch_owner" && profile.branch_id === device.branch_id;
  if (!isHq && !isOwnerOfBranch) {
    return fail(c, "PERMISSION_DENIED", "키 회전 권한이 없습니다", 403);
  }

  const apiKey = generateRandomKey(32);
  const apiKeyEncrypted = await encryptDeviceKey(c.env.DEVICE_KMS_KEY, apiKey);
  const apiKeyFingerprint = fingerprintKey(apiKey);

  const { error } = await db
    .from("access_devices")
    .update({
      api_key_encrypted: apiKeyEncrypted,
      api_key_fingerprint: apiKeyFingerprint,
    })
    .eq("id", deviceId);
  if (error) return fail(c, "INTERNAL_ERROR", error.message, 500);

  return ok(
    c,
    {
      device_id: deviceId,
      api_key: apiKey,
      api_key_fingerprint: apiKeyFingerprint,
    },
    "키가 교체되었습니다. 단말기 측 키도 즉시 갱신하세요."
  );
});

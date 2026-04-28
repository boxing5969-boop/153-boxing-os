import type { MiddlewareHandler } from "hono";
import type { Env } from "../lib/env";
import { fail } from "../lib/responses";
import { hmacVerify, sha256Hex } from "../lib/hmac";
import { decryptDeviceKey } from "../lib/keyEncryption";
import { getServiceClient } from "../lib/supabase";

const MAX_TIMESTAMP_DRIFT_SECONDS = 60;

declare module "hono" {
  interface ContextVariableMap {
    deviceId: string;
  }
}

async function resolveDeviceApiKey(
  env: Env,
  deviceId: string
): Promise<string | null> {
  // 단말기별 암호화 키 우선 — Phase 8 부터 운영 권장
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const db = getServiceClient(env);
      const { data } = await db
        .from("access_devices")
        .select("api_key_encrypted")
        .eq("id", deviceId)
        .maybeSingle();
      const enc = (data as { api_key_encrypted: string | null } | null)
        ?.api_key_encrypted;
      if (enc && env.DEVICE_KMS_KEY) {
        return decryptDeviceKey(env.DEVICE_KMS_KEY, enc);
      }
    } catch (err) {
      console.error("[deviceAuth] resolveDeviceApiKey", err);
    }
  }
  // Fallback: shared DEVICE_API_KEY (Phase 4-7 호환)
  return env.DEVICE_API_KEY ?? null;
}

export const requireDeviceAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const deviceId = c.req.header("X-Device-Id");
  const timestamp = c.req.header("X-Timestamp");
  const signature = c.req.header("X-Signature");

  if (!deviceId || !timestamp || !signature) {
    return fail(
      c,
      "AUTH_REQUIRED",
      "Device headers missing (X-Device-Id, X-Timestamp, X-Signature)",
      401
    );
  }

  const ts = parseInt(timestamp, 10);
  if (Number.isNaN(ts)) {
    return fail(c, "INVALID_TIMESTAMP", "X-Timestamp must be a unix epoch second", 401);
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_TIMESTAMP_DRIFT_SECONDS) {
    return fail(c, "TIMESTAMP_OUT_OF_RANGE", `Timestamp drift > ${MAX_TIMESTAMP_DRIFT_SECONDS}s`, 401);
  }

  const method = c.req.method;
  const path = new URL(c.req.url).pathname;
  const bodyText =
    method === "POST" || method === "PUT" || method === "PATCH" ? await c.req.text() : "";
  const bodyHash = await sha256Hex(bodyText);

  const data = `${ts}\n${method}\n${path}\n${bodyHash}`;

  const apiKey = await resolveDeviceApiKey(c.env, deviceId);
  if (!apiKey) {
    return fail(c, "INTERNAL_ERROR", "Device API key not resolvable", 500);
  }

  const valid = await hmacVerify(apiKey, data, signature);
  if (!valid) {
    return fail(c, "INVALID_SIGNATURE", "HMAC signature mismatch", 401);
  }

  c.set("deviceId", deviceId);
  await next();
  return;
};

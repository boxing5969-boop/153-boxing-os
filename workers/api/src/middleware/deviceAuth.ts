import type { MiddlewareHandler } from "hono";
import type { Env } from "../lib/env";
import { fail } from "../lib/responses";
import { hmacVerify, sha256Hex } from "../lib/hmac";

const MAX_TIMESTAMP_DRIFT_SECONDS = 60;

declare module "hono" {
  interface ContextVariableMap {
    deviceId: string;
  }
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
  // Hono caches body internally so subsequent c.req.json() in route still works
  const bodyText =
    method === "POST" || method === "PUT" || method === "PATCH" ? await c.req.text() : "";
  const bodyHash = await sha256Hex(bodyText);

  const data = `${ts}\n${method}\n${path}\n${bodyHash}`;

  const apiKey = c.env.DEVICE_API_KEY;
  if (!apiKey) {
    return fail(c, "INTERNAL_ERROR", "DEVICE_API_KEY not configured", 500);
  }

  const valid = await hmacVerify(apiKey, data, signature);
  if (!valid) {
    return fail(c, "INVALID_SIGNATURE", "HMAC signature mismatch", 401);
  }

  c.set("deviceId", deviceId);
  await next();
  return;
};

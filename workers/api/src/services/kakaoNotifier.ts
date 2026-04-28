/**
 * Kakao AlimTalk via Solapi
 * Sender: 153 BOXING HQ channel
 * Recipient: branch owner (franchise owner)
 *
 * Required secrets (wrangler secret put):
 *   SOLAPI_API_KEY
 *   SOLAPI_API_SECRET
 *   SOLAPI_SENDER_KEY   -- Kakao channel pfId (KA01PF...)
 *   SENDER_PHONE        -- HQ representative number (no dashes, e.g. 15991999)
 *   KAKAO_EXPIRY_TPL_D7 -- template ID for D-7 (KA01TP...)
 *   KAKAO_EXPIRY_TPL_D3 -- template ID for D-3
 *   KAKAO_EXPIRY_TPL_D1 -- template ID for D-1
 */

import type { Env } from "../lib/env";

export interface NotificationTarget {
  member_id: string;
  membership_id: string;
  member_name: string;
  plan_name: string;
  end_date: string;
  days_left: number;
  notification_type: string;
  branch_name: string;
  owner_phone: string | null;
}

export interface SendResult {
  success: boolean;
  error?: string;
}

// Solapi HMAC-SHA256 auth header
async function makeAuthHeader(apiKey: string, apiSecret: string): Promise<string> {
  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, "");
  const message = apiKey + date + salt;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const signature = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

// Send single alimtalk to branch owner
export async function sendExpiryNotification(
  env: Env,
  target: NotificationTarget
): Promise<SendResult> {
  if (!env.SOLAPI_API_KEY || !env.SOLAPI_API_SECRET || !env.SOLAPI_SENDER_KEY || !env.SENDER_PHONE) {
    return { success: false, error: "Solapi env vars not configured" };
  }

  if (!target.owner_phone) {
    return { success: false, error: "No owner phone for branch: " + target.branch_name };
  }

  const templateId = resolveTemplateId(env, target.notification_type);
  if (!templateId) {
    return { success: false, error: "Template not configured: " + target.notification_type };
  }

  const ownerPhone = normalizePhone(target.owner_phone);
  if (!ownerPhone) {
    return { success: false, error: "Invalid phone format: " + target.owner_phone };
  }

  const endDateFormatted = target.end_date.replace(/-/g, ".");

  // Variables must match the approved Kakao template exactly
  const variables: Record<string, string> = {
    "#{지점명}": target.branch_name,
    "#{회원명}": target.member_name,
    "#{플랜명}": target.plan_name,
    "#{만료일}": endDateFormatted,
    "#{남은일수}": String(target.days_left),
  };

  const body = {
    message: {
      to: ownerPhone,
      from: env.SENDER_PHONE,
      kakaoOptions: {
        pfId: env.SOLAPI_SENDER_KEY,
        templateId,
        variables,
      },
    },
  };

  try {
    const authHeader = await makeAuthHeader(env.SOLAPI_API_KEY, env.SOLAPI_API_SECRET);
    const res = await fetch("https://api.solapi.com/messages/v4/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { success: false, error: `Solapi ${res.status}: ${text.slice(0, 200)}` };
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "unknown fetch error",
    };
  }
}

export interface ExpiryNotificationReport {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
}

export async function runExpiryNotifications(
  env: Env,
  targets: NotificationTarget[]
): Promise<ExpiryNotificationReport> {
  if (targets.length === 0) return { total: 0, sent: 0, failed: 0, skipped: 0 };

  if (!env.SOLAPI_API_KEY) {
    console.warn("[alimtalk] SOLAPI_API_KEY not set -- skipping");
    return { total: targets.length, sent: 0, failed: 0, skipped: targets.length };
  }

  let sent = 0;
  let failed = 0;

  for (const target of targets) {
    const result = await sendExpiryNotification(env, target);
    if (result.success) {
      sent++;
      console.log(`[alimtalk] sent to ${target.branch_name} owner for ${target.member_name} (${target.notification_type})`);
    } else {
      failed++;
      console.error(`[alimtalk] failed ${target.member_name} (${target.notification_type}): ${result.error}`);
    }
  }

  return { total: targets.length, sent, failed, skipped: 0 };
}

function resolveTemplateId(env: Env, notificationType: string): string | null {
  switch (notificationType) {
    case "expiry_d7": return env.KAKAO_EXPIRY_TPL_D7 ?? null;
    case "expiry_d3": return env.KAKAO_EXPIRY_TPL_D3 ?? null;
    case "expiry_d1": return env.KAKAO_EXPIRY_TPL_D1 ?? null;
    default: return null;
  }
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 11) return null;
  return digits;
}

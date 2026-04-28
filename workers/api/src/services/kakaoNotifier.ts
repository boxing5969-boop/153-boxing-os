/**
 * 카카오 알림톡 발송 — Solapi 경유
 * https://docs.solapi.com/api-reference/messages/send-many
 *
 * 환경변수 (wrangler secret put):
 *   SOLAPI_API_KEY      Solapi API Key
 *   SOLAPI_API_SECRET   Solapi API Secret
 *   SOLAPI_SENDER_KEY   카카오 채널 pfId (KA01PF...)
 *   KAKAO_EXPIRY_TPL_D7  알림톡 템플릿 ID — D-7 (KA01TP...)
 *   KAKAO_EXPIRY_TPL_D3  알림톡 템플릿 ID — D-3
 *   KAKAO_EXPIRY_TPL_D1  알림톡 템플릿 ID — D-1
 *   SENDER_PHONE        발신 번호 (15991999 형식, 하이픈 없이)
 */

import type { Env } from "../lib/env";

export interface NotificationTarget {
  member_id: string;
  membership_id: string;
  member_name: string;
  member_phone: string;
  plan_name: string;
  end_date: string;
  days_left: number;
  notification_type: string;
}

export interface SendResult {
  success: boolean;
  error?: string;
}

// ────────────────────────────────────────────────────────────
// Solapi HMAC 인증 헬퍼
// ────────────────────────────────────────────────────────────
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

// ────────────────────────────────────────────────────────────
// 단건 발송
// ────────────────────────────────────────────────────────────
export async function sendExpiryNotification(
  env: Env,
  target: NotificationTarget
): Promise<SendResult> {
  // 필수 환경변수 확인
  if (
    !env.SOLAPI_API_KEY ||
    !env.SOLAPI_API_SECRET ||
    !env.SOLAPI_SENDER_KEY ||
    !env.SENDER_PHONE
  ) {
    return { success: false, error: "Solapi 환경변수 미설정 (SOLAPI_API_KEY 등)" };
  }

  const templateId = resolveTemplateId(env, target.notification_type);
  if (!templateId) {
    return { success: false, error: `템플릿 미설정: ${target.notification_type}` };
  }

  const endDateFormatted = target.end_date
    .replace(/-/g, ".")
    .replace(/\.(\d)$/, ".$1"); // YYYY.MM.DD

  const variables: Record<string, string> = {
    "#{회원명}": target.member_name,
    "#{플랜명}": target.plan_name,
    "#{만료일}": endDateFormatted,
    "#{남은일수}": String(target.days_left),
  };

  const phone = normalizePhone(target.member_phone);
  if (!phone) {
    return { success: false, error: `전화번호 형식 오류: ${target.member_phone}` };
  }

  const body = {
    message: {
      to: phone,
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

// ────────────────────────────────────────────────────────────
// 일괄 발송 (cron 용)
// ────────────────────────────────────────────────────────────
export interface ExpiryNotificationReport {
  total: number;
  sent: number;
  failed: number;
  skipped: number; // 환경변수 미설정 시 전체 skip
}

export async function runExpiryNotifications(
  env: Env,
  targets: NotificationTarget[]
): Promise<ExpiryNotificationReport> {
  if (targets.length === 0) {
    return { total: 0, sent: 0, failed: 0, skipped: 0 };
  }

  if (!env.SOLAPI_API_KEY) {
    console.warn("[알림톡] SOLAPI_API_KEY 미설정 — 알림톡 발송 건너뜀");
    return { total: targets.length, sent: 0, failed: 0, skipped: targets.length };
  }

  let sent = 0;
  let failed = 0;

  for (const target of targets) {
    const result = await sendExpiryNotification(env, target);
    if (result.success) {
      sent++;
      console.log(`[알림톡] ✓ ${target.member_name} (${target.notification_type})`);
    } else {
      failed++;
      console.error(
        `[알림톡] ✗ ${target.member_name} (${target.notification_type}): ${result.error}`
      );
    }
  }

  return { total: targets.length, sent, failed, skipped: 0 };
}

// ────────────────────────────────────────────────────────────
// 헬퍼
// ────────────────────────────────────────────────────────────
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
  if (digits.length < 10 || digits.length > 11) return null;
  return digits;
}

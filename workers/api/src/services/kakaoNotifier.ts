/**
 * Kakao AlimTalk via Solapi -- per-branch billing
 *
 * Each branch has its own Solapi account and Kakao channel.
 * Credentials are stored encrypted in branches table.
 * The HQ fallback (env vars) is used only if branch has no credentials.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptDeviceKey } from "../lib/keyEncryption";
import type { Env } from "../lib/env";

export interface NotificationTarget {
  member_id: string;
  membership_id: string;
  member_name: string;
  plan_name: string;
  end_date: string;
  days_left: number;
  notification_type: string;
  branch_id: string;
  branch_name: string;
  owner_phone: string | null;
}

export interface SendResult {
  success: boolean;
  error?: string;
}

interface BranchKakaoConfig {
  apiKey: string;
  apiSecret: string;
  pfId: string;
  senderPhone: string;
  templateId: string;
}

async function getBranchKakaoConfig(
  db: SupabaseClient,
  env: Env,
  branchId: string,
  notificationType: string
): Promise<BranchKakaoConfig | null> {
  const { data } = await db
    .from("branches")
    .select("kakao_api_key_enc,kakao_api_secret_enc,kakao_pfid,kakao_sender_phone,kakao_tpl_d7,kakao_tpl_d3,kakao_tpl_d1,kakao_enabled")
    .eq("id", branchId)
    .maybeSingle();

  type BranchRow = {
    kakao_api_key_enc: string | null;
    kakao_api_secret_enc: string | null;
    kakao_pfid: string | null;
    kakao_sender_phone: string | null;
    kakao_tpl_d7: string | null;
    kakao_tpl_d3: string | null;
    kakao_tpl_d1: string | null;
    kakao_enabled: boolean;
  };
  const b = data as BranchRow | null;
  if (!b || !b.kakao_enabled) return null;
  if (!b.kakao_api_key_enc || !b.kakao_api_secret_enc) return null;
  if (!b.kakao_pfid || !b.kakao_sender_phone) return null;

  const tpl = notificationType === "expiry_d7" ? b.kakao_tpl_d7
            : notificationType === "expiry_d3" ? b.kakao_tpl_d3
            : notificationType === "expiry_d1" ? b.kakao_tpl_d1
            : null;
  if (!tpl) return null;

  if (!env.DEVICE_KMS_KEY) return null;

  const [apiKey, apiSecret] = await Promise.all([
    decryptDeviceKey(env.DEVICE_KMS_KEY, b.kakao_api_key_enc),
    decryptDeviceKey(env.DEVICE_KMS_KEY, b.kakao_api_secret_enc),
  ]);

  return { apiKey, apiSecret, pfId: b.kakao_pfid, senderPhone: b.kakao_sender_phone, templateId: tpl };
}

async function makeAuthHeader(apiKey: string, apiSecret: string): Promise<string> {
  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, "");
  const message = apiKey + date + salt;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(apiSecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const signature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,"0")).join("");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

export async function sendExpiryNotification(
  db: SupabaseClient,
  env: Env,
  target: NotificationTarget
): Promise<SendResult> {
  const config = await getBranchKakaoConfig(db, env, target.branch_id, target.notification_type);
  if (!config) {
    return { success: false, error: `Kakao not configured for branch: ${target.branch_name}` };
  }

  if (!target.owner_phone) {
    return { success: false, error: "No owner phone for branch: " + target.branch_name };
  }
  const ownerPhone = target.owner_phone.replace(/\D/g, "");
  if (ownerPhone.length < 9) return { success: false, error: "Invalid phone: " + target.owner_phone };

  const body = {
    message: {
      to: ownerPhone,
      from: config.senderPhone,
      kakaoOptions: {
        pfId: config.pfId,
        templateId: config.templateId,
        variables: {
          "#{지점명}": target.branch_name,
          "#{회원명}": target.member_name,
          "#{플랜명}": target.plan_name,
          "#{만료일}": target.end_date.replace(/-/g, "."),
          "#{남은일수}": String(target.days_left),
        },
      },
    },
  };

  try {
    const authHeader = await makeAuthHeader(config.apiKey, config.apiSecret);
    const res = await fetch("https://api.solapi.com/messages/v4/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { success: false, error: `Solapi ${res.status}: ${text.slice(0, 200)}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "fetch error" };
  }
}

export interface ExpiryNotificationReport {
  total: number; sent: number; failed: number; skipped: number;
}

export async function runExpiryNotifications(
  db: SupabaseClient,
  env: Env,
  targets: NotificationTarget[]
): Promise<ExpiryNotificationReport> {
  if (targets.length === 0) return { total: 0, sent: 0, failed: 0, skipped: 0 };
  let sent = 0; let failed = 0; let skipped = 0;
  for (const target of targets) {
    const result = await sendExpiryNotification(db, env, target);
    if (result.success) {
      sent++;
      console.log(`[alimtalk] sent -> ${target.branch_name} / ${target.member_name} (${target.notification_type})`);
    } else if (result.error?.includes("not configured")) {
      skipped++;
      console.log(`[alimtalk] skip -> ${target.branch_name}: ${result.error}`);
    } else {
      failed++;
      console.error(`[alimtalk] fail -> ${target.member_name}: ${result.error}`);
    }
  }
  return { total: targets.length, sent, failed, skipped };
}

/**
 * Kakao AlimTalk via Solapi -- per-branch billing
 *
 * Each branch has its own Solapi account and Kakao channel.
 * Credentials are stored encrypted in branches table.
 * The HQ fallback (env vars) is used only if branch has no credentials.
 *
 * 발송 대상: 회원 본인 번호 (마케팅 동의 회원만 DB RPC에서 필터)
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
  member_phone: string | null; // 회원 본인 번호
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

  // 회원 본인 번호로 발송
  if (!target.member_phone) {
    return { success: false, error: `회원 번호 없음: ${target.member_name}` };
  }
  const recipientPhone = target.member_phone.replace(/\D/g, "");
  if (recipientPhone.length < 9) {
    return { success: false, error: `유효하지 않은 번호: ${target.member_phone}` };
  }

  const body = {
    message: {
      to: recipientPhone,
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

export interface TargetResult {
  target: NotificationTarget;
  result: SendResult;
}

export async function runExpiryNotifications(
  db: SupabaseClient,
  env: Env,
  targets: NotificationTarget[]
): Promise<{ report: ExpiryNotificationReport; results: TargetResult[] }> {
  if (targets.length === 0) {
    return { report: { total: 0, sent: 0, failed: 0, skipped: 0 }, results: [] };
  }

  let sent = 0; let failed = 0; let skipped = 0;
  const results: TargetResult[] = [];

  for (const target of targets) {
    const result = await sendExpiryNotification(db, env, target);
    results.push({ target, result });

    if (result.success) {
      sent++;
      console.log(`[alimtalk] sent → ${target.member_name} (${target.member_phone}) / ${target.notification_type}`);
    } else if (result.error?.includes("not configured")) {
      skipped++;
      console.log(`[alimtalk] skip → ${target.branch_name}: ${result.error}`);
    } else {
      failed++;
      console.error(`[alimtalk] fail → ${target.member_name}: ${result.error}`);
    }
  }

  return { report: { total: targets.length, sent, failed, skipped }, results };
}

// ── 설문 안내 알림톡 ───────────────────────────────────────
/**
 * 설문 안내 알림톡 발송 (branches.kakao_tpl_survey 템플릿 사용)
 * - 자유문구가 아닌 카카오 사전 승인 템플릿이 필요하다.
 * - 템플릿 미설정 시 실패를 반환 → 디스패처에서 SMS 폴백 처리.
 * - 알림톡 실패 시 알리고 자체 LMS 폴백(failoverYn=Y)도 함께 동작.
 *
 * @param message 설문 링크가 포함된 완성 메시지 (템플릿 본문과 일치해야 함)
 */
export async function sendSurveyAlimtalk(
  db: SupabaseClient,
  env: Env,
  branchId: string,
  toPhone: string,
  message: string
): Promise<SendResult> {
  const { data } = await db
    .from("branches")
    .select("kakao_api_key_enc,kakao_api_secret_enc,kakao_pfid,kakao_sender_phone,kakao_tpl_survey,kakao_enabled,name")
    .eq("id", branchId)
    .maybeSingle();

  type Row = {
    kakao_api_key_enc: string | null;
    kakao_api_secret_enc: string | null;
    kakao_pfid: string | null;
    kakao_sender_phone: string | null;
    kakao_tpl_survey: string | null;
    kakao_enabled: boolean;
    name: string | null;
  };
  const b = data as Row | null;

  if (!b || !b.kakao_enabled) return { success: false, error: "알림톡 미설정" };
  if (!b.kakao_api_key_enc || !b.kakao_api_secret_enc) return { success: false, error: "알림톡 API 키 미설정" };
  if (!b.kakao_pfid || !b.kakao_sender_phone) return { success: false, error: "알림톡 발신프로필 미설정" };
  if (!b.kakao_tpl_survey) return { success: false, error: "설문 알림톡 템플릿(kakao_tpl_survey) 미설정" };
  if (!env.DEVICE_KMS_KEY) return { success: false, error: "KMS 키 미설정" };

  const recipientPhone = toPhone.replace(/\D/g, "");
  if (recipientPhone.length < 9) {
    return { success: false, error: `유효하지 않은 번호: ${toPhone}` };
  }

  const [apiKey, userId] = await Promise.all([
    decryptDeviceKey(env.DEVICE_KMS_KEY, b.kakao_api_key_enc),
    decryptDeviceKey(env.DEVICE_KMS_KEY, b.kakao_api_secret_enc),
  ]);

  const subject = `${b.name ?? "153 Boxing"} 설문 안내`;
  const params = new URLSearchParams({
    apikey: apiKey,
    userid: userId,
    senderkey: b.kakao_pfid,
    tpl_code: b.kakao_tpl_survey,
    sender: b.kakao_sender_phone.replace(/\D/g, ""),
    receiver_1: recipientPhone,
    subject_1: subject,
    message_1: message,
    // 알림톡 실패 시 LMS 자동 폴백 (알리고 자체 기능)
    failoverYn: "Y",
    failover_type: "LMS",
    failover_subject: subject,
    failover_content: message,
  });

  try {
    const res = await fetch("https://kakaoapi.aligo.in/brandtalk/send/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const json = await res.json() as { code: number; message: string };
    if (json.code !== 0) {
      return { success: false, error: `알리고 알림톡 [${json.code}] ${json.message}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "fetch error" };
  }
}

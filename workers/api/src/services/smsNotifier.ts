/**
 * SMS 발송 via Solapi
 * 카카오 알림톡과 동일한 Solapi 계정 / HMAC 인증 사용
 * LMS 타입으로 장문 문자 발송
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptDeviceKey } from "../lib/keyEncryption";
import type { Env } from "../lib/env";

export interface SmsSendResult {
  success: boolean;
  error?: string;
}

interface BranchSmsConfig {
  apiKey: string;
  apiSecret: string;
  senderPhone: string;
}

async function getBranchSmsConfig(
  db: SupabaseClient,
  env: Env,
  branchId: string
): Promise<BranchSmsConfig | null> {
  const { data } = await db
    .from("branches")
    .select("kakao_api_key_enc,kakao_api_secret_enc,sms_sender_phone,kakao_sender_phone,kakao_enabled")
    .eq("id", branchId)
    .maybeSingle();

  type BranchRow = {
    kakao_api_key_enc: string | null;
    kakao_api_secret_enc: string | null;
    sms_sender_phone: string | null;
    kakao_sender_phone: string | null;
    kakao_enabled: boolean;
  };
  const b = data as BranchRow | null;
  if (!b) return null;
  if (!b.kakao_api_key_enc || !b.kakao_api_secret_enc) return null;

  // SMS 발신번호: sms_sender_phone 우선, 없으면 kakao_sender_phone
  const senderPhone = b.sms_sender_phone ?? b.kakao_sender_phone;
  if (!senderPhone) return null;

  if (!env.DEVICE_KMS_KEY) return null;
  const [apiKey, apiSecret] = await Promise.all([
    decryptDeviceKey(env.DEVICE_KMS_KEY, b.kakao_api_key_enc),
    decryptDeviceKey(env.DEVICE_KMS_KEY, b.kakao_api_secret_enc),
  ]);

  return { apiKey, apiSecret, senderPhone };
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
  const signature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

/** 변수 치환: #{회원명} #{만료일} #{남은일수} #{지점명} #{플랜명} */
export function substituteVars(
  content: string,
  vars: {
    member_name?: string;
    end_date?: string;
    days_left?: number;
    branch_name?: string;
    plan_name?: string;
  }
): string {
  return content
    .replace(/#{회원명}/g, vars.member_name ?? "")
    .replace(/#{만료일}/g, vars.end_date ? vars.end_date.replace(/-/g, ".") : "")
    .replace(/#{남은일수}/g, vars.days_left != null ? String(vars.days_left) : "")
    .replace(/#{지점명}/g, vars.branch_name ?? "")
    .replace(/#{플랜명}/g, vars.plan_name ?? "");
}

export async function sendSms(
  db: SupabaseClient,
  env: Env,
  branchId: string,
  toPhone: string,
  content: string
): Promise<SmsSendResult> {
  const config = await getBranchSmsConfig(db, env, branchId);
  if (!config) {
    return { success: false, error: "SMS 설정 없음 (Solapi API 키 또는 발신번호 미설정)" };
  }

  const recipientPhone = toPhone.replace(/\D/g, "");
  if (recipientPhone.length < 9) {
    return { success: false, error: `유효하지 않은 번호: ${toPhone}` };
  }

  // 90바이트 초과면 LMS, 이하면 SMS
  const byteLen = new TextEncoder().encode(content).length;
  const msgType = byteLen > 90 ? "LMS" : "SMS";

  const body = {
    message: {
      to: recipientPhone,
      from: config.senderPhone.replace(/\D/g, ""),
      text: content,
      type: msgType,
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
      return { success: false, error: `Solapi SMS ${res.status}: ${text.slice(0, 200)}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "fetch error" };
  }
}

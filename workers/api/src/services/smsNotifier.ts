/**
 * SMS 발송 via 알리고(Aligo)
 * - API Key + User ID 방식 (HMAC 불필요, 단순 POST form)
 * - SMS: 8.4원/건, LMS: 25원/건 (Solapi 대비 30~40% 저렴)
 * - 알리고 API 문서: https://smartsms.aligo.in/admin/api/spec.html
 *
 * DB 컬럼 매핑 (Solapi → 알리고 재활용, DB 변경 없음):
 *   kakao_api_key_enc    → 알리고 API Key (암호화 저장)
 *   kakao_api_secret_enc → 알리고 User ID (암호화 저장)
 *   sms_sender_phone     → SMS 발신번호
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
  userId: string;
  senderPhone: string;
}

// EUC-KR 바이트 계산 (한글 2byte, ASCII 1byte)
function calcBytes(text: string): number {
  let count = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    count += code > 127 ? 2 : 1;
  }
  return count;
}

async function getBranchSmsConfig(
  db: SupabaseClient,
  env: Env,
  branchId: string
): Promise<BranchSmsConfig | null> {
  const { data } = await db
    .from("branches")
    .select("kakao_api_key_enc,kakao_api_secret_enc,sms_sender_phone,kakao_sender_phone")
    .eq("id", branchId)
    .maybeSingle();

  type BranchRow = {
    kakao_api_key_enc: string | null;
    kakao_api_secret_enc: string | null;
    sms_sender_phone: string | null;
    kakao_sender_phone: string | null;
  };
  const b = data as BranchRow | null;
  if (!b) return null;
  if (!b.kakao_api_key_enc || !b.kakao_api_secret_enc) return null;

  // SMS 발신번호: sms_sender_phone 우선, 없으면 kakao_sender_phone
  const senderPhone = b.sms_sender_phone ?? b.kakao_sender_phone;
  if (!senderPhone) return null;
  if (!env.DEVICE_KMS_KEY) return null;

  const [apiKey, userId] = await Promise.all([
    decryptDeviceKey(env.DEVICE_KMS_KEY, b.kakao_api_key_enc),
    decryptDeviceKey(env.DEVICE_KMS_KEY, b.kakao_api_secret_enc),
  ]);

  return { apiKey, userId, senderPhone };
}

/** 변수 치환: #{회원명} #{만료일} #{남은일수} #{지점명} #{플랜명} #{설문링크} */
export function substituteVars(
  content: string,
  vars: {
    member_name?: string;
    end_date?: string;
    days_left?: number;
    branch_name?: string;
    plan_name?: string;
    survey_url?: string;
  }
): string {
  return content
    .replace(/#{회원명}/g, vars.member_name ?? "")
    .replace(/#{만료일}/g, vars.end_date ? vars.end_date.replace(/-/g, ".") : "")
    .replace(/#{남은일수}/g, vars.days_left != null ? String(vars.days_left) : "")
    .replace(/#{지점명}/g, vars.branch_name ?? "")
    .replace(/#{플랜명}/g, vars.plan_name ?? "")
    .replace(/#{설문링크}/g, vars.survey_url ?? "");
}

/** 알리고 SMS/LMS 발송 */
export async function sendSms(
  db: SupabaseClient,
  env: Env,
  branchId: string,
  toPhone: string,
  content: string
): Promise<SmsSendResult> {
  const config = await getBranchSmsConfig(db, env, branchId);
  if (!config) {
    return { success: false, error: "SMS 설정 없음 (알리고 API 키 또는 발신번호 미설정)" };
  }

  const recipientPhone = toPhone.replace(/\D/g, "");
  if (recipientPhone.length < 9) {
    return { success: false, error: `유효하지 않은 번호: ${toPhone}` };
  }

  // EUC-KR 기준 90바이트 초과 시 LMS
  const byteLen = calcBytes(content);
  const msgType = byteLen > 90 ? "LMS" : "SMS";

  const params = new URLSearchParams({
    key: config.apiKey,
    user_id: config.userId,
    sender: config.senderPhone.replace(/\D/g, ""),
    receiver: recipientPhone,
    msg: content,
    msg_type: msgType,
  });
  if (msgType === "LMS") params.set("title", "153복싱짐 안내");

  try {
    const res = await fetch("https://apis.aligo.in/send/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const json = await res.json() as {
      result_code: string;
      message: string;
      success_cnt?: number;
      error_cnt?: number;
    };

    // result_code "1" = 성공
    if (json.result_code !== "1") {
      return { success: false, error: `알리고 [${json.result_code}] ${json.message}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "fetch error" };
  }
}

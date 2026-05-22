/**
 * 카카오 알림톡 발송 via 알리고(Aligo)
 * - API Key + User ID + Sender Key 방식
 * - 알림톡: 4.8원/건 (Solapi 8원 대비 40% 저렴)
 * - 알리고 알림톡 API 문서: https://smartsms.aligo.in/alimapi.html
 *
 * DB 컬럼 매핑 (Solapi → 알리고 재활용, DB 변경 없음):
 *   kakao_api_key_enc    → 알리고 API Key (암호화)
 *   kakao_api_secret_enc → 알리고 User ID (암호화)
 *   kakao_pfid           → 알리고 Sender Key (발신프로필 키, 40자 해시)
 *   kakao_sender_phone   → 발신번호
 *   kakao_tpl_d7/d3/d1   → 알리고 템플릿 코드
 *
 * ※ 알림톡은 카카오 승인 템플릿만 발송 가능.
 *   자유문자(공지 등)는 messageDispatcher에서 SMS로 처리.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptDeviceKey } from "../lib/keyEncryption";
import { NOTIFY_CONCURRENCY, processWithLimit } from "../lib/concurrency";
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
  member_phone: string | null;
}

export interface SendResult {
  success: boolean;
  error?: string;
}

interface BranchKakaoConfig {
  apiKey: string;
  userId: string;
  senderKey: string;   // 알리고 발신프로필 키 (구 Solapi pfId)
  senderPhone: string;
  templateCode: string; // 알리고 템플릿 코드 (구 Solapi templateId)
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

  const tplCode = notificationType === "expiry_d7" ? b.kakao_tpl_d7
               : notificationType === "expiry_d3" ? b.kakao_tpl_d3
               : notificationType === "expiry_d1" ? b.kakao_tpl_d1
               : null;
  if (!tplCode) return null;
  if (!env.DEVICE_KMS_KEY) return null;

  const [apiKey, userId] = await Promise.all([
    decryptDeviceKey(env.DEVICE_KMS_KEY, b.kakao_api_key_enc),
    decryptDeviceKey(env.DEVICE_KMS_KEY, b.kakao_api_secret_enc),
  ]);

  return { apiKey, userId, senderKey: b.kakao_pfid, senderPhone: b.kakao_sender_phone, templateCode: tplCode };
}

/**
 * 만료 예정 알림톡 발송 (템플릿 기반)
 * 알리고 endpoint: POST https://kakaoapi.aligo.in/brandtalk/send/
 */
export async function sendExpiryNotification(
  db: SupabaseClient,
  env: Env,
  target: NotificationTarget
): Promise<SendResult> {
  const config = await getBranchKakaoConfig(db, env, target.branch_id, target.notification_type);
  if (!config) {
    return { success: false, error: `알림톡 미설정: ${target.branch_name}` };
  }

  if (!target.member_phone) {
    return { success: false, error: `회원 번호 없음: ${target.member_name}` };
  }
  const recipientPhone = target.member_phone.replace(/\D/g, "");
  if (recipientPhone.length < 9) {
    return { success: false, error: `유효하지 않은 번호: ${target.member_phone}` };
  }

  // 템플릿 변수 치환 메시지 (알리고는 message_1에 완성된 텍스트 전달)
  const message = [
    `안녕하세요 ${target.member_name}님,`,
    `${target.branch_name}입니다.`,
    ``,
    `${target.plan_name} 이용권이 ${target.days_left}일 후`,
    `${target.end_date.replace(/-/g, ".")}에 만료됩니다.`,
    ``,
    `재등록 문의는 지점으로 연락 주세요.`,
  ].join("\n");

  const params = new URLSearchParams({
    apikey: config.apiKey,
    userid: config.userId,
    senderkey: config.senderKey,
    tpl_code: config.templateCode,
    sender: config.senderPhone.replace(/\D/g, ""),
    receiver_1: recipientPhone,
    subject_1: `${target.branch_name} 이용권 만료 안내`,
    message_1: message,
    // 알림톡 실패 시 SMS 자동 폴백 (알리고 자체 기능)
    failoverYn: "Y",
    failover_type: "LMS",
    failover_subject: `${target.branch_name} 이용권 만료 안내`,
    failover_content: message,
  });

  try {
    const res = await fetch("https://kakaoapi.aligo.in/brandtalk/send/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const json = await res.json() as { code: number; message: string };

    // code 0 = 성공
    if (json.code !== 0) {
      return { success: false, error: `알리고 알림톡 [${json.code}] ${json.message}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "fetch error" };
  }
}

// ── 일괄 발송 ──────────────────────────────────────────────

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
  const results: TargetResult[] = new Array(targets.length);

  // 알리고 rate limit (~500/분) 대비 동시 발송 NOTIFY_CONCURRENCY 로 제한.
  await processWithLimit(targets, NOTIFY_CONCURRENCY, async (target, i) => {
    const result = await sendExpiryNotification(db, env, target);
    results[i] = { target, result };

    if (result.success) {
      sent++;
      console.log(`[alimtalk] 발송 완료 → ${target.member_name} (${target.member_phone}) / ${target.notification_type}`);
    } else if (result.error?.includes("미설정")) {
      skipped++;
      console.log(`[alimtalk] 스킵 → ${target.branch_name}: ${result.error}`);
    } else {
      failed++;
      console.error(`[alimtalk] 실패 → ${target.member_name}: ${result.error}`);
    }
  });

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

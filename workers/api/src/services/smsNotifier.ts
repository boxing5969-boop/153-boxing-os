/**
 * SMS 발송 래퍼 (Phase 1: NAVER Cloud SENS)
 *
 * - 실제 HTTP 호출·서명 생성은 sensClient.ts 가 담당
 * - 이 파일은 per-branch 인증정보를 DB 에서 로드해 sensClient 에 전달
 * - 시그니처(`sendSms(db, env, branchId, toPhone, content)`)는 유지하여
 *   기존 5개 호출부(fc/hr/dailyReporter/messageDispatcher/surveyDispatcher) 무수정
 *
 * DB 컬럼 매핑 (마이그레이션 없이 기존 컬럼 재활용):
 *   kakao_api_key_enc    → NCP Access Key (암호화)
 *   kakao_api_secret_enc → NCP Secret Key (암호화)
 *   kakao_pfid           → NCP Service ID (평문 — 식별자라 비암호화)
 *   sms_sender_phone     → 발신번호 (없으면 kakao_sender_phone)
 *
 * 참고: docs/sens-migration.md
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptDeviceKey } from "../lib/keyEncryption";
import type { Env } from "../lib/env";
import { sendSensSms, sendSensFriendTalk, type SensConfig } from "./sensClient";

export interface SmsSendResult {
  success: boolean;
  error?: string;
}

async function getBranchSensConfig(
  db: SupabaseClient,
  env: Env,
  branchId: string,
): Promise<SensConfig | null> {
  const { data } = await db
    .from("branches")
    .select(
      "kakao_api_key_enc,kakao_api_secret_enc,kakao_pfid,sms_sender_phone,kakao_sender_phone",
    )
    .eq("id", branchId)
    .maybeSingle();

  type BranchRow = {
    kakao_api_key_enc: string | null;
    kakao_api_secret_enc: string | null;
    kakao_pfid: string | null;
    sms_sender_phone: string | null;
    kakao_sender_phone: string | null;
  };
  const b = data as BranchRow | null;
  if (!b) return null;
  if (!b.kakao_api_key_enc || !b.kakao_api_secret_enc) return null;
  if (!b.kakao_pfid) return null;

  // 발신번호: sms_sender_phone 우선, 없으면 kakao_sender_phone
  const fromPhone = b.sms_sender_phone ?? b.kakao_sender_phone;
  if (!fromPhone) return null;
  if (!env.DEVICE_KMS_KEY) return null;

  const [accessKey, secretKey] = await Promise.all([
    decryptDeviceKey(env.DEVICE_KMS_KEY, b.kakao_api_key_enc),
    decryptDeviceKey(env.DEVICE_KMS_KEY, b.kakao_api_secret_enc),
  ]);

  return {
    accessKey,
    secretKey,
    serviceId: b.kakao_pfid,
    fromPhone,
  };
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
  },
): string {
  return content
    .replace(/#{회원명}/g, vars.member_name ?? "")
    .replace(/#{만료일}/g, vars.end_date ? vars.end_date.replace(/-/g, ".") : "")
    .replace(/#{남은일수}/g, vars.days_left != null ? String(vars.days_left) : "")
    .replace(/#{지점명}/g, vars.branch_name ?? "")
    .replace(/#{플랜명}/g, vars.plan_name ?? "")
    .replace(/#{설문링크}/g, vars.survey_url ?? "");
}

/**
 * NCP SENS SMS는 멀티바이트 이모지를 거부한다(400: "cannot contain multibyte emoji characters").
 * 발송 직전 이모지·변이선택자(FE0F)·ZWJ(200D)를 제거하고, 이모지 제거로 생긴 꼬리 공백을 정리한다.
 * (카카오 친구톡/브랜드메시지는 이모지를 허용하므로 sendFriendTalk 경로에는 적용하지 않는다.)
 */
export function stripEmojiForSms(content: string): string {
  return content
    .replace(/[\p{Extended_Pictographic}\u200D\uFE0F]/gu, "")
    .replace(/[ \t]+([.,!?~])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trimEnd();
}

export async function sendSms(
  db: SupabaseClient,
  env: Env,
  branchId: string,
  toPhone: string,
  content: string,
): Promise<SmsSendResult> {
  const config = await getBranchSensConfig(db, env, branchId);
  if (!config) {
    return {
      success: false,
      error: "SMS 설정 없음 (NCP SENS Access Key / Secret Key / Service ID / 발신번호 미설정)",
    };
  }
  const result = await sendSensSms(config, toPhone, stripEmojiForSms(content));
  return { success: result.success, error: result.error };
}

/** 지점의 카카오 채널 ID(@채널 = NCP 친구톡 plusFriendId). 미설정이면 null. */
async function getBranchKakaoChannelId(
  db: SupabaseClient,
  branchId: string,
): Promise<string | null> {
  const { data } = await db
    .from("branches")
    .select("kakao_channel_id")
    .eq("id", branchId)
    .maybeSingle();
  const v = (data as { kakao_channel_id: string | null } | null)?.kakao_channel_id;
  return v && v.trim() ? v.trim() : null;
}

/**
 * 친구톡으로 보낼 때 본문에서 SMS용 광고 장식을 제거한다.
 * 카카오가 (광고) 머리말과 무료 수신거부(채널 차단)를 자동으로 붙이므로,
 * "(광고)" 접두어와 끝부분 "무료수신거부 [수신거부번호]/번호" 줄을 떼어낸다.
 */
export function stripAdDecorations(content: string): string {
  return content
    .replace(/^\s*\(광고\)\s*/, "")
    .replace(/\s*무료\s*수신거부[^\n]*$/u, "")
    .trim();
}

/** 지점의 카카오 비즈메시지 서비스 ID(ncp:kkobizmsg:...). SMS serviceId(kakao_pfid)와 다름. */
async function getBranchBizmsgServiceId(
  db: SupabaseClient,
  branchId: string,
): Promise<string | null> {
  const { data } = await db
    .from("branches")
    .select("kakao_bizmsg_service_id")
    .eq("id", branchId)
    .maybeSingle();
  const v = (data as { kakao_bizmsg_service_id: string | null } | null)
    ?.kakao_bizmsg_service_id;
  return v && v.trim() ? v.trim() : null;
}

/**
 * 카카오 브랜드 메시지 발송 (광고성). 친구톡(2025-12-31 종료) 후속 서비스.
 * 지점에 카카오 채널(@아이디) + 비즈메시지 서비스 ID 가 모두 있어야 한다.
 * 미설정이면 실패를 반환해 호출부가 SMS 경로로 처리하거나 차단하게 한다.
 * (함수명은 호출부 호환을 위해 유지 — 실제 동작은 브랜드메시지.)
 */
export async function sendFriendTalk(
  db: SupabaseClient,
  env: Env,
  branchId: string,
  toPhone: string,
  content: string,
  opts?: { isAd?: boolean },
): Promise<SmsSendResult> {
  const config = await getBranchSensConfig(db, env, branchId);
  if (!config) {
    return { success: false, error: "NCP 설정 없음 (브랜드메시지 발송 불가)" };
  }
  const channelId = await getBranchKakaoChannelId(db, branchId);
  if (!channelId) {
    return { success: false, error: "카카오 채널 미설정 (브랜드메시지 발송 불가)" };
  }
  const bizmsgServiceId = await getBranchBizmsgServiceId(db, branchId);
  if (!bizmsgServiceId) {
    return { success: false, error: "카카오 비즈메시지 서비스 ID 미설정 (브랜드메시지 발송 불가)" };
  }
  const bodyText = opts?.isAd ? stripAdDecorations(content) : content;
  // 브랜드메시지는 SMS와 다른 비즈메시지 serviceId 를 쓴다(IAM 키·발신번호는 동일 계정).
  const cfg = { ...config, serviceId: bizmsgServiceId };
  const result = await sendSensFriendTalk(cfg, channelId, toPhone, bodyText, {
    targeting: "I",
  });
  return { success: result.success, error: result.error };
}

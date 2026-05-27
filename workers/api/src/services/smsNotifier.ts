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
import { sendSensSms, type SensConfig } from "./sensClient";

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
  const result = await sendSensSms(config, toPhone, content);
  return { success: result.success, error: result.error };
}

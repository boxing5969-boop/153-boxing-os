/**
 * Kakao AlimTalk — Phase 1 disabled.
 *
 * Phase 1 정책 (CLAUDE.md):
 *   - 알리고 라이브 경로는 사용 금지
 *   - 라이브 SMS 는 NCP SENS 만 사용 (smsNotifier.ts)
 *   - 카카오 알림톡은 본 파일의 두 export 함수가 항상 disabled 응답을 반환한다
 *   - 호출부(messageDispatcher / surveyDispatcher / dailyReporter 등)는 그대로 두며
 *     실패 응답을 받으면 SMS 폴백으로 동작
 *
 * Phase 2 (재개 시):
 *   - 원본 Solapi 알림톡 구현은 git 히스토리에서 복원 가능
 *   - 또는 NCP SENS Alimtalk API 로 재구현 (sensClient 확장)
 *
 * 참고: docs/sens-migration.md
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../lib/env";

// ── 호출부 호환을 위해 기존 타입은 유지 ──────────────────────

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

export interface ExpiryNotificationReport {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
}

export interface TargetResult {
  target: NotificationTarget;
  result: SendResult;
}

// ── Phase 1 stub: 만료 알림톡 ────────────────────────────────

/**
 * 회원권 만료 알림톡 — Phase 1 disabled.
 * 디스패처는 실패 응답을 받아 SMS(NCP SENS) 폴백 경로로 떨어진다.
 */
export async function sendExpiryNotification(
  _db: SupabaseClient,
  _env: Env,
  _target: NotificationTarget,
): Promise<SendResult> {
  return {
    success: false,
    error: "카카오 알림톡 Phase 1 미지원 (NCP SENS Alimtalk 마이그레이션 대기 중)",
  };
}

/**
 * 배치 실행 — Phase 1 에서는 모두 skipped 로 처리된다.
 */
export async function runExpiryNotifications(
  db: SupabaseClient,
  env: Env,
  targets: NotificationTarget[],
): Promise<{ report: ExpiryNotificationReport; results: TargetResult[] }> {
  if (targets.length === 0) {
    return { report: { total: 0, sent: 0, failed: 0, skipped: 0 }, results: [] };
  }

  const results: TargetResult[] = [];
  for (const target of targets) {
    const result = await sendExpiryNotification(db, env, target);
    results.push({ target, result });
    // Phase 1: 항상 disabled → skipped 로 집계
  }

  return {
    report: { total: targets.length, sent: 0, failed: 0, skipped: targets.length },
    results,
  };
}

// ── Phase 1 stub: 설문 안내 알림톡 ───────────────────────────

/**
 * 설문 안내 알림톡 — Phase 1 disabled.
 * surveyDispatcher 는 실패 응답을 받아 SMS(NCP SENS) 폴백 경로로 떨어진다.
 */
export async function sendSurveyAlimtalk(
  _db: SupabaseClient,
  _env: Env,
  _branchId: string,
  _toPhone: string,
  _message: string,
): Promise<SendResult> {
  return {
    success: false,
    error: "카카오 알림톡 Phase 1 미지원 (NCP SENS Alimtalk 마이그레이션 대기 중) — SMS 폴백 사용",
  };
}

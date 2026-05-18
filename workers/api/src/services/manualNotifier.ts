/**
 * 수동 발송 로직
 * - 즉시발송 (오늘의 자동 발송 대상 즉시 실행)
 * - 회원 개별 발송
 * - 그룹 발송 (만료 N일 이내 필터)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../lib/env";
import {
  sendExpiryNotification,
  type NotificationTarget,
  type SendResult,
} from "./kakaoNotifier";

export interface ManualSendReport {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  details: Array<{
    member_name: string;
    member_phone: string | null;
    status: "sent" | "failed" | "skipped";
    error?: string;
  }>;
}

/** 즉시발송: 오늘의 자동 알림 대상을 즉시 실행 */
export async function runNotificationsNow(
  db: SupabaseClient,
  env: Env
): Promise<ManualSendReport> {
  const { data, error } = await db.rpc("get_expiry_notification_targets");
  if (error) throw new Error("알림 대상 조회 실패: " + error.message);

  const targets = (data ?? []) as NotificationTarget[];
  return sendTargets(db, env, targets, true);
}

interface BulkFilter {
  days_ahead: number;
  branch_id?: string;
  dry_run?: boolean;
}

/** 그룹 발송: 만료 N일 이내 회원에게 일괄 발송 */
export async function runBulkNotification(
  db: SupabaseClient,
  env: Env,
  filter: BulkFilter
): Promise<{ targets_count: number; report?: ManualSendReport }> {
  const { days_ahead, branch_id, dry_run = false } = filter;

  // 만료 N일 이내 + 마케팅 동의 + 전화번호 있는 활성 이용권 회원 조회
  type BulkRow = {
    member_id: string;
    membership_id: string;
    member_name: string;
    plan_name: string;
    end_date: string;
    days_left: number;
    branch_id: string;
    branch_name: string;
    member_phone: string;
  };

  const { data, error } = await db.rpc("get_bulk_notification_targets", {
    _days_ahead: days_ahead,
    _branch_id: branch_id ?? null,
  });
  if (error) throw new Error("대상 조회 실패: " + error.message);

  const rows = (data ?? []) as BulkRow[];
  if (dry_run) return { targets_count: rows.length };

  const targets: NotificationTarget[] = rows.map((r) => ({
    member_id: r.member_id,
    membership_id: r.membership_id,
    member_name: r.member_name,
    plan_name: r.plan_name,
    end_date: r.end_date,
    days_left: r.days_left,
    notification_type: daysToType(r.days_left),
    branch_id: r.branch_id,
    branch_name: r.branch_name,
    member_phone: r.member_phone,
  }));

  const report = await sendTargets(db, env, targets, false);
  return { targets_count: rows.length, report };
}

/** 회원 개별 발송 */
export interface MemberNotifyResult {
  success: boolean;
  error?: string;
  member_name: string;
  member_phone: string | null;
  notification_type: string;
}

export async function sendMemberNotification(
  db: SupabaseClient,
  env: Env,
  memberId: string
): Promise<MemberNotifyResult> {
  // 회원 + 활성 이용권 + 마케팅 동의 조회
  const { data: memberRaw } = await db
    .from("members")
    .select("id, name, phone, branch_id, branches!inner(name)")
    .eq("id", memberId)
    .maybeSingle();

  type MemberRow = {
    id: string; name: string; phone: string | null;
    branch_id: string;
    branches: { name: string };
  };
  const member = memberRaw as MemberRow | null;
  if (!member) return { success: false, error: "회원을 찾을 수 없습니다", member_name: "", member_phone: null, notification_type: "" };
  if (!member.phone) return { success: false, error: "전화번호가 없습니다", member_name: member.name, member_phone: null, notification_type: "" };

  // 마케팅 동의 확인
  const { data: consentRaw } = await db
    .from("consent_records")
    .select("id")
    .eq("member_id", memberId)
    .eq("consent_type", "marketing")
    .eq("agreed", true)
    .is("revoked_at", null)
    .maybeSingle();
  if (!consentRaw) {
    return { success: false, error: "마케팅 수신 동의를 받지 않은 회원입니다", member_name: member.name, member_phone: member.phone, notification_type: "" };
  }

  // 활성 이용권 조회
  const today = new Date().toISOString().slice(0, 10);
  const { data: msRaw } = await db
    .from("memberships")
    .select("id, plan_name, end_date")
    .eq("member_id", memberId)
    .eq("status", "active")
    .in("payment_status", ["paid", "partial"])
    .gte("end_date", today)
    .order("end_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  type MsRow = { id: string; plan_name: string; end_date: string };
  const ms = msRaw as MsRow | null;
  if (!ms) {
    return { success: false, error: "유효한 이용권이 없습니다", member_name: member.name, member_phone: member.phone, notification_type: "" };
  }

  const daysLeft = Math.max(0, Math.floor(
    (new Date(ms.end_date).getTime() - new Date(today).getTime()) / 86400000
  ));
  const notificationType = daysToType(daysLeft);

  const target: NotificationTarget = {
    member_id: member.id,
    membership_id: ms.id,
    member_name: member.name,
    plan_name: ms.plan_name,
    end_date: ms.end_date,
    days_left: daysLeft,
    notification_type: notificationType,
    branch_id: member.branch_id,
    branch_name: member.branches.name,
    member_phone: member.phone,
  };

  const result: SendResult = await sendExpiryNotification(db, env, target);

  // 발송 결과 기록
  await db.rpc("record_expiry_notification", {
    _member_id: member.id,
    _membership_id: ms.id,
    _notification_type: notificationType,
    _status: result.success ? "sent" : "failed",
    _error_message: result.success ? null : (result.error ?? null),
    _recipient_phone: member.phone,
  });

  return {
    success: result.success,
    error: result.error,
    member_name: member.name,
    member_phone: member.phone,
    notification_type: notificationType,
  };
}

// ── 내부 유틸 ──────────────────────────────────────────────

/** days_left → notification_type 매핑 (수동 발송은 d7을 기본값으로) */
function daysToType(days: number): string {
  if (days <= 1) return "expiry_d1";
  if (days <= 3) return "expiry_d3";
  return "expiry_d7";
}

async function sendTargets(
  db: SupabaseClient,
  env: Env,
  targets: NotificationTarget[],
  recordResult: boolean
): Promise<ManualSendReport> {
  let sent = 0; let failed = 0; let skipped = 0;
  const details: ManualSendReport["details"] = [];

  for (const target of targets) {
    const result: SendResult = await sendExpiryNotification(db, env, target);

    if (result.success) {
      sent++;
      details.push({ member_name: target.member_name, member_phone: target.member_phone, status: "sent" });
    } else if (result.error?.includes("not configured") || result.error?.includes("Kakao not configured")) {
      skipped++;
      details.push({ member_name: target.member_name, member_phone: target.member_phone, status: "skipped", error: result.error });
    } else {
      failed++;
      details.push({ member_name: target.member_name, member_phone: target.member_phone, status: "failed", error: result.error });
    }

    if (recordResult) {
      const status = result.success ? "sent" : "failed";
      await db.rpc("record_expiry_notification", {
        _member_id: target.member_id,
        _membership_id: target.membership_id,
        _notification_type: target.notification_type,
        _status: status,
        _error_message: result.success ? null : (result.error ?? null),
        _recipient_phone: target.member_phone ?? null,
      }).catch((e: unknown) => console.error("[manualNotifier] record failed:", e));
    }
  }

  return { total: targets.length, sent, failed, skipped, details };
}

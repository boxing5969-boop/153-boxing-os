/**
 * 통합 메시지 디스패처
 * channel에 따라 SMS / 카카오 / 둘 다 / 카카오→SMS 폴백 발송
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../lib/env";
import { sendSms, substituteVars } from "./smsNotifier";
import { sendExpiryNotification, type NotificationTarget } from "./kakaoNotifier";

export type NotifyChannel = "sms" | "kakao" | "both" | "kakao_sms_fallback";

export interface DispatchTarget {
  member_id: string;
  membership_id?: string;
  member_name: string;
  plan_name?: string;
  end_date?: string;
  days_left?: number;
  branch_id: string;
  branch_name: string;
  member_phone: string;
  notification_type?: string;
  survey_url?: string; // #{설문링크} 치환용
}

export interface DispatchResult {
  sms?: { success: boolean; error?: string };
  kakao?: { success: boolean; error?: string };
  overall_success: boolean;
}

/** 단일 회원에게 채널에 따라 메시지 발송 */
export async function dispatchMessage(
  db: SupabaseClient,
  env: Env,
  target: DispatchTarget,
  channel: NotifyChannel,
  content: string // SMS용 자유 텍스트 (카카오는 template 사용)
): Promise<DispatchResult> {
  const result: DispatchResult = { overall_success: false };

  const resolvedContent = substituteVars(content, {
    member_name:  target.member_name,
    end_date:     target.end_date,
    days_left:    target.days_left,
    branch_name:  target.branch_name,
    plan_name:    target.plan_name,
    survey_url:   target.survey_url,
  });

  if (channel === "sms") {
    const r = await sendSms(db, env, target.branch_id, target.member_phone, resolvedContent);
    result.sms = r;
    result.overall_success = r.success;

  } else if (channel === "kakao") {
    if (!target.membership_id || !target.notification_type) {
      result.kakao = { success: false, error: "카카오: membership_id / notification_type 필요" };
    } else {
      const kakaoTarget: NotificationTarget = {
        member_id: target.member_id,
        membership_id: target.membership_id,
        member_name: target.member_name,
        plan_name: target.plan_name ?? "",
        end_date: target.end_date ?? "",
        days_left: target.days_left ?? 0,
        notification_type: target.notification_type,
        branch_id: target.branch_id,
        branch_name: target.branch_name,
        member_phone: target.member_phone,
      };
      const r = await sendExpiryNotification(db, env, kakaoTarget);
      result.kakao = r;
      result.overall_success = r.success;
    }

  } else if (channel === "both") {
    // SMS + 카카오 동시 발송
    const [smsR, kakaoR] = await Promise.all([
      sendSms(db, env, target.branch_id, target.member_phone, resolvedContent),
      target.membership_id && target.notification_type
        ? sendExpiryNotification(db, env, {
            member_id: target.member_id, membership_id: target.membership_id,
            member_name: target.member_name, plan_name: target.plan_name ?? "",
            end_date: target.end_date ?? "", days_left: target.days_left ?? 0,
            notification_type: target.notification_type,
            branch_id: target.branch_id, branch_name: target.branch_name,
            member_phone: target.member_phone,
          })
        : Promise.resolve({ success: false, error: "카카오: 정보 부족" }),
    ]);
    result.sms = smsR;
    result.kakao = kakaoR;
    result.overall_success = smsR.success || kakaoR.success;

  } else if (channel === "kakao_sms_fallback") {
    // 카카오 먼저, 실패 시 SMS
    let kakaoOk = false;
    if (target.membership_id && target.notification_type) {
      const r = await sendExpiryNotification(db, env, {
        member_id: target.member_id, membership_id: target.membership_id,
        member_name: target.member_name, plan_name: target.plan_name ?? "",
        end_date: target.end_date ?? "", days_left: target.days_left ?? 0,
        notification_type: target.notification_type,
        branch_id: target.branch_id, branch_name: target.branch_name,
        member_phone: target.member_phone,
      });
      result.kakao = r;
      kakaoOk = r.success;
    } else {
      result.kakao = { success: false, error: "카카오: 정보 부족" };
    }

    if (!kakaoOk) {
      const smsR = await sendSms(db, env, target.branch_id, target.member_phone, resolvedContent);
      result.sms = smsR;
      result.overall_success = smsR.success;
    } else {
      result.overall_success = true;
    }
  }

  // 발송 이력 message_send_logs에 기록
  const logRows: Array<{
    branch_id: string; member_id: string; channel: string;
    recipient_phone: string; content_preview: string;
    trigger_type: string | null; status: string; error_message: string | null;
  }> = [];

  if (result.sms) {
    logRows.push({
      branch_id: target.branch_id, member_id: target.member_id,
      channel: "sms", recipient_phone: target.member_phone,
      content_preview: resolvedContent.slice(0, 100),
      trigger_type: target.notification_type ?? null,
      status: result.sms.success ? "sent" : "failed",
      error_message: result.sms.error ?? null,
    });
  }
  if (result.kakao) {
    logRows.push({
      branch_id: target.branch_id, member_id: target.member_id,
      channel: "kakao", recipient_phone: target.member_phone,
      content_preview: resolvedContent.slice(0, 100),
      trigger_type: target.notification_type ?? null,
      status: result.kakao.success ? "sent" : "failed",
      error_message: result.kakao.error ?? null,
    });
  }

  if (logRows.length > 0) {
    // Supabase 쿼리빌더는 .catch() 가 없으므로 await 후 error 를 확인한다.
    const { error: logErr } = await db.from("message_send_logs").insert(logRows);
    if (logErr) console.error("[dispatcher] log insert failed:", logErr);
  }

  return result;
}

/** 그룹에 일괄 발송 (membership_notifications 기록 포함) */
export interface GroupDispatchReport {
  total: number; success: number; failed: number;
}

export async function dispatchToGroup(
  db: SupabaseClient,
  env: Env,
  targets: DispatchTarget[],
  channel: NotifyChannel,
  content: string,
  scheduledMsgId?: string
): Promise<GroupDispatchReport> {
  let success = 0; let failed = 0;

  for (const target of targets) {
    const result = await dispatchMessage(db, env, target, channel, content);

    if (result.overall_success) success++;
    else failed++;

    // 기존 membership_notifications에도 기록 (중복 방지용)
    if (target.membership_id && target.notification_type) {
      const status = result.overall_success ? "sent" : "failed";
      const { error: recErr } = await db.rpc("record_expiry_notification", {
        _member_id: target.member_id, _membership_id: target.membership_id,
        _notification_type: target.notification_type,
        _status: status, _error_message: null,
        _recipient_phone: target.member_phone,
      });
      if (recErr) console.error("[dispatcher] record_expiry_notification failed:", recErr);
    }

    // 예약 발송 이력 업데이트
    if (scheduledMsgId) {
      const { error: schErr } = await db.from("scheduled_messages")
        .update({
          sent_count: success,
          fail_count: failed,
        })
        .eq("id", scheduledMsgId);
      if (schErr) console.error("[dispatcher] scheduled_messages update failed:", schErr);
    }
  }

  return { total: targets.length, success, failed };
}

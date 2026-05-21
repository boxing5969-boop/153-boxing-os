/**
 * 설문 초대 디스패처
 * - 회원별 개인 설문 링크(/s/{slug}?t={token}) 생성
 * - 채널에 따라 SMS / 알림톡 발송
 * - survey_invitations 상태(sent/failed) 갱신
 *
 * app_push / email / manual 채널은 자동 발송 없이 링크만 생성하여 반환한다.
 * (이메일 발송사·랭킹업앱 푸시 API는 추후 Phase에서 연동)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../lib/env";
import { sendSms, substituteVars } from "./smsNotifier";
import { sendSurveyAlimtalk } from "./kakaoNotifier";

export type SurveyChannel =
  | "sms" | "kakao" | "both" | "kakao_sms_fallback"
  | "app_push" | "email" | "manual";

export interface SurveySendMember {
  id: string;
  name: string;
  phone: string | null;
}

export interface SurveySendInput {
  qr_code_id: string;
  slug: string;
  survey_template_id: string;
  branch_id: string;
  branch_name: string;
  channel: SurveyChannel;
  content: string;        // #{설문링크} #{회원명} #{지점명} 변수 포함
  base_url: string;       // 공개 설문 베이스 URL (Cloudflare Pages)
  created_by: string | null;
  members: SurveySendMember[];
}

export interface SurveySendLink {
  member_id: string;
  member_name: string;
  url: string;
  status: string;
  error?: string;
}

export interface SurveySendReport {
  total: number;
  sent: number;
  failed: number;
  skipped: number;        // 발송 없이 링크만 생성된 건수
  links: SurveySendLink[];
}

/** /s/{slug}?t={token} 개인 링크 생성 */
function buildSurveyLink(base: string, slug: string, token: string): string {
  const b = base.replace(/\/+$/, "");
  return `${b}/s/${slug}?t=${encodeURIComponent(token)}`;
}

const AUTO_SEND_CHANNELS = new Set<SurveyChannel>([
  "sms", "kakao", "both", "kakao_sms_fallback",
]);

export async function dispatchSurveyInvitations(
  db: SupabaseClient,
  env: Env,
  input: SurveySendInput
): Promise<SurveySendReport> {
  const report: SurveySendReport = {
    total: input.members.length,
    sent: 0, failed: 0, skipped: 0, links: [],
  };

  if (input.members.length === 0) return report;

  // 1. 초대 레코드 일괄 생성 (회원별 고유 토큰 자동 발급)
  const inviteRows = input.members.map((m) => ({
    survey_template_id: input.survey_template_id,
    qr_code_id:         input.qr_code_id,
    branch_id:          input.branch_id,
    member_id:          m.id,
    channel:            input.channel,
    status:             "pending",
    recipient_phone:    m.phone,
    created_by:         input.created_by,
  }));

  const { data: created, error } = await db
    .from("survey_invitations")
    .insert(inviteRows)
    .select("id, member_id, token");

  if (error) throw new Error(`초대 생성 실패: ${error.message}`);

  const inviteByMember = new Map<string, { id: string; token: string }>();
  for (const row of (created ?? []) as Array<{ id: string; member_id: string; token: string }>) {
    inviteByMember.set(row.member_id, { id: row.id, token: row.token });
  }

  const autoSend = AUTO_SEND_CHANNELS.has(input.channel);

  // 2. 회원별 발송
  for (const m of input.members) {
    const inv = inviteByMember.get(m.id);
    if (!inv) {
      report.failed++;
      report.links.push({ member_id: m.id, member_name: m.name, url: "", status: "failed", error: "초대 생성 누락" });
      continue;
    }

    const url = buildSurveyLink(input.base_url, input.slug, inv.token);
    const content = substituteVars(input.content, {
      member_name: m.name,
      branch_name: input.branch_name,
      survey_url:  url,
    });

    // 자동 발송 대상 아님 → 링크만 생성
    if (!autoSend) {
      report.skipped++;
      report.links.push({ member_id: m.id, member_name: m.name, url, status: "pending" });
      continue;
    }

    // 연락처 없음
    if (!m.phone) {
      report.failed++;
      await db.from("survey_invitations")
        .update({ status: "failed", error_message: "연락처 없음" })
        .eq("id", inv.id);
      report.links.push({ member_id: m.id, member_name: m.name, url, status: "failed", error: "연락처 없음" });
      continue;
    }

    let success = false;
    let errMsg: string | undefined;

    if (input.channel === "sms") {
      const r = await sendSms(db, env, input.branch_id, m.phone, content);
      success = r.success; errMsg = r.error;

    } else if (input.channel === "kakao") {
      const r = await sendSurveyAlimtalk(db, env, input.branch_id, m.phone, content);
      success = r.success; errMsg = r.error;

    } else if (input.channel === "both") {
      const [s, k] = await Promise.all([
        sendSms(db, env, input.branch_id, m.phone, content),
        sendSurveyAlimtalk(db, env, input.branch_id, m.phone, content),
      ]);
      success = s.success || k.success;
      if (!success) {
        errMsg = `SMS: ${s.error} / 알림톡: ${k.error}`;
      } else if (!s.success || !k.success) {
        // 한쪽만 성공한 부분 실패 — 발송 자체는 됐지만(sent) 실패한 채널을
        // error_message 에 남겨 운영자가 알림톡 템플릿 오류 등을 확인할 수 있게 한다.
        errMsg = !s.success
          ? `부분 실패 — SMS 실패: ${s.error}`
          : `부분 실패 — 알림톡 실패: ${k.error}`;
      }

    } else { // kakao_sms_fallback
      const k = await sendSurveyAlimtalk(db, env, input.branch_id, m.phone, content);
      if (k.success) {
        success = true;
      } else {
        const s = await sendSms(db, env, input.branch_id, m.phone, content);
        success = s.success;
        errMsg = s.success ? undefined : `알림톡: ${k.error} / SMS: ${s.error}`;
      }
    }

    if (success) report.sent++;
    else report.failed++;

    await db.from("survey_invitations")
      .update({
        status: success ? "sent" : "failed",
        sent_at: success ? new Date().toISOString() : null,
        error_message: errMsg ?? null,
      })
      .eq("id", inv.id);

    report.links.push({
      member_id: m.id, member_name: m.name, url,
      status: success ? "sent" : "failed", error: errMsg,
    });
  }

  return report;
}

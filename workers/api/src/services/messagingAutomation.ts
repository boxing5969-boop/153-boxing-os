/**
 * 메시징 자동화 — 1단계 (혼합형 발송)
 *
 * fc_daily_run(run_playbooks) 이 message_suggestions(draft) 를 만든 뒤 이 모듈이:
 *  1) personalizeTodaysSuggestions — 본문의 #{변수} 를 회원·지점 데이터로 치환
 *     (run_playbooks 는 템플릿 content 를 그대로 저장하므로, 발송 전 치환이 필요)
 *  2) autoSendInformational — 정보성 플레이북(예: 미납)의 draft 를 자동발송
 *     마케팅·관계성은 draft 로 남겨 FcTaskInboxPage 검토 큐에서 직원이 발송.
 *
 * 안전장치
 *  - 자동발송은 지점이 명시적으로 켠 경우에만(branches.notify_triggers.auto_informational=true). 기본 OFF.
 *  - draft→sent 원자적 전환으로 중복발송 차단. safety_status='block' 은 제외.
 *  - 발송 결과는 message_send_logs 에 기록.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "../lib/supabase";
import { sendSms } from "./smsNotifier";
import type { Env } from "../lib/env";

/** 정보성(자동발송 대상) 플레이북 트리거 세그먼트.
 *  - unpaid_member: 미납 안내(거래 정보성)
 *  - welcome_new: 신규 가입 환영(거래 정보성)
 *  나머지(미출석·생일·체험·재등록 등 관계·마케팅성)는 검토 큐에서 직원이 발송. */
export const INFORMATIONAL_TRIGGER_SEGMENTS = ["unpaid_member", "welcome_new"] as const;

interface MemberCtx {
  member_name: string;
  phone: string | null;
  branch_id: string;
  branch_name: string;
  branch_phone: string | null;
  expiry_date: string | null;
  days_until_expiry: number | null;
  plan_name: string | null;
  auto_informational: boolean;
}

/** 회원·지점·스냅샷 맥락 로드 */
async function loadMemberCtx(
  db: SupabaseClient,
  memberId: string,
): Promise<MemberCtx | null> {
  const { data: m } = await db
    .from("members")
    .select("name, phone, branch_id, branches(name, phone, notify_triggers)")
    .eq("id", memberId)
    .maybeSingle();
  const row = m as {
    name: string; phone: string | null; branch_id: string;
    branches: { name: string; phone: string | null; notify_triggers: Record<string, unknown> | null } | null;
  } | null;
  if (!row) return null;

  const { data: snap } = await db
    .from("member_status_snapshots")
    .select("membership_expiry_date, days_until_expiry")
    .eq("member_id", memberId)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const s = snap as { membership_expiry_date: string | null; days_until_expiry: number | null } | null;

  const triggers = row.branches?.notify_triggers ?? null;
  return {
    member_name: row.name,
    phone: row.phone,
    branch_id: row.branch_id,
    branch_name: row.branches?.name ?? "",
    branch_phone: row.branches?.phone ?? null,
    expiry_date: s?.membership_expiry_date ?? null,
    days_until_expiry: s?.days_until_expiry ?? null,
    plan_name: null,
    auto_informational: triggers?.["auto_informational"] === true,
  };
}

/** #{변수} 치환 (기존 substituteVars 규약 확장: #{지점전화} 추가) */
export function personalizeBody(content: string, ctx: MemberCtx): string {
  return content
    .replace(/#{회원명}/g, ctx.member_name ?? "")
    .replace(/#{지점명}/g, ctx.branch_name ?? "")
    .replace(/#{지점전화}/g, ctx.branch_phone ?? "")
    .replace(/#{만료일}/g, ctx.expiry_date ? ctx.expiry_date.replace(/-/g, ".") : "")
    .replace(/#{남은일수}/g, ctx.days_until_expiry != null && ctx.days_until_expiry >= 0 ? String(ctx.days_until_expiry) : "")
    .replace(/#{플랜명}/g, ctx.plan_name ?? "");
}

interface DraftRow {
  id: string;
  branch_id: string;
  member_id: string;
  generated_body: string | null;
  safety_status: string;
  playbook_rule_id: string | null;
}

/** 1) 오늘의 draft 본문에서 #{변수} 를 치환해 저장 (검토·자동발송 공통 정리) */
export async function personalizeTodaysSuggestions(env: Env): Promise<number> {
  const db = getServiceClient(env);
  const { data, error } = await db
    .from("message_suggestions")
    .select("id, branch_id, member_id, generated_body, safety_status, playbook_rule_id")
    .eq("status", "draft")
    .like("generated_body", "%#{%");
  if (error) {
    console.error("[msgAuto] personalize fetch", error);
    return 0;
  }
  const drafts = (data ?? []) as DraftRow[];
  let updated = 0;
  for (const d of drafts) {
    if (!d.generated_body) continue;
    const ctx = await loadMemberCtx(db, d.member_id);
    if (!ctx) continue;
    const body = personalizeBody(d.generated_body, ctx);
    if (body === d.generated_body) continue;
    const { error: upErr } = await db
      .from("message_suggestions")
      .update({ generated_body: body })
      .eq("id", d.id);
    if (upErr) { console.error("[msgAuto] personalize update", upErr); continue; }
    updated++;
  }
  return updated;
}

/** 2) 정보성 플레이북의 draft 를 자동발송 (지점이 켠 경우에만) */
export async function autoSendInformational(env: Env): Promise<{ sent: number; failed: number; skipped: number }> {
  const db = getServiceClient(env);
  let sent = 0, failed = 0, skipped = 0;

  // 정보성 플레이북 규칙 id 수집
  const { data: rules } = await db
    .from("playbook_rules")
    .select("id")
    .in("trigger_segment", INFORMATIONAL_TRIGGER_SEGMENTS as unknown as string[])
    .is("deleted_at", null);
  const ruleIds = ((rules ?? []) as { id: string }[]).map((r) => r.id);
  if (ruleIds.length === 0) return { sent, failed, skipped };

  const { data, error } = await db
    .from("message_suggestions")
    .select("id, branch_id, member_id, generated_body, safety_status, playbook_rule_id")
    .eq("status", "draft")
    .neq("safety_status", "block")
    .in("playbook_rule_id", ruleIds);
  if (error) {
    console.error("[msgAuto] autoSend fetch", error);
    return { sent, failed, skipped };
  }
  const drafts = (data ?? []) as DraftRow[];

  for (const d of drafts) {
    const ctx = await loadMemberCtx(db, d.member_id);
    if (!ctx) { skipped++; continue; }
    // 지점이 자동발송을 켰고, 전화번호가 있고, 본문이 있을 때만
    if (!ctx.auto_informational || !ctx.phone || !d.generated_body?.trim()) { skipped++; continue; }

    const body = d.generated_body.includes("#{") ? personalizeBody(d.generated_body, ctx) : d.generated_body;

    // 원자적 점유: draft → sent (동시 실행/재실행 중복발송 차단)
    const { data: claimed, error: claimErr } = await db
      .from("message_suggestions")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", d.id)
      .eq("status", "draft")
      .select("id");
    if (claimErr || !claimed || claimed.length === 0) { skipped++; continue; }

    const result = await sendSms(db, env, d.branch_id, ctx.phone, body);

    if (!result.success) {
      // 실패 — draft 로 되돌려 다음 실행에서 재시도
      await db.from("message_suggestions").update({ status: "draft", sent_at: null }).eq("id", d.id);
      failed++;
    } else {
      sent++;
    }

    await db.from("message_send_logs").insert({
      branch_id: d.branch_id,
      member_id: d.member_id,
      channel: "sms",
      recipient_phone: ctx.phone,
      content_preview: body.slice(0, 100),
      trigger_type: "auto_informational",
      status: result.success ? "sent" : "failed",
      error_message: result.error ?? null,
    });
  }

  return { sent, failed, skipped };
}

/** fc_daily_run 직후 호출 — 본문 치환 + 정보성 자동발송 */
export async function runMessagingAutomation(env: Env): Promise<void> {
  const personalized = await personalizeTodaysSuggestions(env);
  const auto = await autoSendInformational(env);
  console.log("[msgAuto]", { personalized, ...auto });
}

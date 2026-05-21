import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getAdapter,
  type AccessDeviceAdapter,
  type AdapterContext,
} from "@153/device-adapters";
import { getServiceClient } from "../lib/supabase";
import { decryptDeviceKey } from "../lib/keyEncryption";
import type { Env } from "../lib/env";
import {
  runExpiryNotifications,
  type NotificationTarget,
} from "./kakaoNotifier";
import {
  dispatchToGroup,
  type DispatchTarget,
  type NotifyChannel,
} from "./messageDispatcher";
import { substituteVars } from "./smsNotifier";


const MAX_RETRIES = 5;

interface PendingJob {
  id: string;
  branch_id: string;
  device_id: string;
  job_type: string;
  target_member_id: string | null;
  status: string;
  retry_count: number;
}

interface DeviceRow {
  id: string;
  branch_id: string;
  vendor: string;
  device_identifier: string | null;
  api_endpoint: string | null;
  api_key_encrypted: string | null;
  status: string;
}

async function resolveDeviceApiKey(env: Env, encrypted: string | null): Promise<string> {
  if (!encrypted) return env.DEVICE_API_KEY; // legacy/mock fallback
  if (!env.DEVICE_KMS_KEY) {
    throw new Error("DEVICE_KMS_KEY not configured (cannot decrypt per-device key)");
  }
  return decryptDeviceKey(env.DEVICE_KMS_KEY, encrypted);
}

interface MemberRow {
  id: string;
  name: string;
  phone: string | null;
}

interface DeviceUserRow {
  vendor_user_id: string;
}

export interface ProcessReport {
  fetched: number;
  succeeded: number;
  failed: number;
}

export async function processNextSyncJobs(
  env: Env,
  limit = 50
): Promise<ProcessReport> {
  const db = getServiceClient(env);
  const { data, error } = await db
    .from("device_sync_jobs")
    .select("*")
    .eq("status", "pending")
    .lt("retry_count", MAX_RETRIES)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) {
    console.error("[syncQueue] fetch", error);
    return { fetched: 0, succeeded: 0, failed: 0 };
  }
  const list = (data ?? []) as unknown as PendingJob[];
  if (list.length === 0) return { fetched: 0, succeeded: 0, failed: 0 };

  let succeeded = 0;
  let failed = 0;
  for (const job of list) {
    const ok = await processOne(db, env, job);
    if (ok) succeeded++;
    else failed++;
  }
  return { fetched: list.length, succeeded, failed };
}

async function processOne(
  db: SupabaseClient,
  env: Env,
  job: PendingJob
): Promise<boolean> {
  // mark processing
  await db.from("device_sync_jobs").update({ status: "processing" }).eq("id", job.id);

  try {
    const { data: deviceRaw } = await db
      .from("access_devices")
      .select("id,branch_id,vendor,device_identifier,api_endpoint,api_key_encrypted,status")
      .eq("id", job.device_id)
      .maybeSingle();
    const device = deviceRaw as DeviceRow | null;
    if (!device) throw new Error("device not found");

    const adapter = getAdapter(device.vendor);
    const apiKey = await resolveDeviceApiKey(env, device.api_key_encrypted);
    const ctx: AdapterContext = {
      device: {
        id: device.id,
        vendor: device.vendor,
        device_identifier: device.device_identifier,
        api_endpoint: device.api_endpoint,
      },
      device_api_key: apiKey,
      base_url: device.api_endpoint ?? "",
    };

    let member: MemberRow | null = null;
    if (job.target_member_id) {
      const { data: m } = await db
        .from("members")
        .select("id,name,phone")
        .eq("id", job.target_member_id)
        .maybeSingle();
      member = m as MemberRow | null;
    }

    const vuid = await dispatchJob(db, adapter, ctx, job, member);

    // create_user 후 device_users 매핑 upsert
    if (job.job_type === "create_user" && member && vuid) {
      await db.from("device_users").upsert(
        {
          member_id: member.id,
          device_id: device.id,
          vendor_user_id: vuid,
          status: "active",
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "device_id,vendor_user_id" }
      );
    }

    // success
    await db
      .from("device_sync_jobs")
      .update({
        status: "success",
        processed_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", job.id);

    await db
      .from("access_devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", device.id);

    if (device.status === "error") {
      await db.from("access_devices").update({ status: "active" }).eq("id", device.id);
    }
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    const newRetry = job.retry_count + 1;
    const finalStatus = newRetry >= MAX_RETRIES ? "failed" : "pending";

    await db
      .from("device_sync_jobs")
      .update({
        status: finalStatus,
        retry_count: newRetry,
        error_message: msg,
      })
      .eq("id", job.id);

    if (newRetry >= MAX_RETRIES) {
      await db
        .from("access_devices")
        .update({ status: "error" })
        .eq("id", job.device_id);
      console.error(`[syncQueue] device ${job.device_id} → error after ${MAX_RETRIES} retries`);
    }
    return false;
  }
}

async function dispatchJob(
  db: SupabaseClient,
  adapter: AccessDeviceAdapter,
  ctx: AdapterContext,
  job: PendingJob,
  member: MemberRow | null
): Promise<string | undefined> {
  switch (job.job_type) {
    case "create_user": {
      if (!member) throw new Error("member required for create_user");
      return adapter.createUser(ctx, {
        id: member.id,
        name: member.name,
        phone: member.phone ?? undefined,
      });
    }
    case "update_user": {
      if (!member) throw new Error("member required for update_user");
      const vuid = await resolveVendorUserId(db, job.device_id, member.id);
      if (vuid) {
        await adapter.updateUser(
          ctx,
          { id: member.id, name: member.name, phone: member.phone ?? undefined },
          vuid
        );
        return vuid;
      }
      // 매핑이 없으면 createUser 로 폴백
      return adapter.createUser(ctx, {
        id: member.id,
        name: member.name,
        phone: member.phone ?? undefined,
      });
    }
    case "disable_user": {
      const vuid = await resolveVendorUserId(db, job.device_id, job.target_member_id);
      if (!vuid) return; // 매핑 없으면 no-op (이미 없으니 OK)
      await adapter.disableUser(ctx, vuid);
      return vuid;
    }
    case "delete_user": {
      const vuid = await resolveVendorUserId(db, job.device_id, job.target_member_id);
      if (!vuid) return;
      await adapter.deleteUser(ctx, vuid);
      // 매핑 row 삭제
      await db
        .from("device_users")
        .delete()
        .eq("device_id", job.device_id)
        .eq("vendor_user_id", vuid);
      return vuid;
    }
    case "sync_access_group": {
      const vuid = await resolveVendorUserId(db, job.device_id, job.target_member_id);
      if (!vuid) return;
      await adapter.assignAccessGroup(ctx, vuid, {
        group_id: ctx.device.id,
        name: "default",
      });
      return vuid;
    }
    case "pull_logs": {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await adapter.pullAccessLogs(ctx, since);
      return;
    }
    default:
      throw new Error(`Unknown job_type: ${job.job_type}`);
  }
}

async function resolveVendorUserId(
  db: SupabaseClient,
  deviceId: string,
  memberId: string | null
): Promise<string | null> {
  if (!memberId) return null;
  const { data } = await db
    .from("device_users")
    .select("vendor_user_id")
    .eq("device_id", deviceId)
    .eq("member_id", memberId)
    .maybeSingle();
  const row = data as DeviceUserRow | null;
  return row?.vendor_user_id ?? null;
}

export async function runDailyExpiry(env: Env): Promise<void> {
  const db = getServiceClient(env);

  // 1) 만료 처리
  const { data, error } = await db.rpc("expire_outdated_memberships");
  if (error) {
    console.error("[dailyExpiry]", error);
    return;
  }
  console.log("[dailyExpiry]", data);

  // 2) 만료 예정 알림 (D-7 / D-3 / D-1 + D-0 + D+7) — 지점별 트리거 설정 반영
  await runDailyNotifications(env);
}

/**
 * FC AI Care Center 일배치 (매일 00:05 KST)
 * compute_member_snapshots() → run_playbooks() 를 순차 실행한다.
 * - 회원 상태 스냅샷·세그먼트를 재계산하고
 * - 활성 플레이북을 평가해 message_suggestions(draft)·tasks 를 생성한다.
 * 생성된 메시지는 draft 상태이며 FC 승인 전에는 절대 발송되지 않는다.
 */
export async function runFcDailyRun(env: Env): Promise<void> {
  const db = getServiceClient(env);
  // fc_daily_run 은 생성 타입에 미포함 — 인자 없는 RPC 명으로 캐스팅
  const { data, error } = await db.rpc(
    "fc_daily_run" as "expire_outdated_memberships",
  );
  if (error) {
    console.error("[fcDailyRun]", error);
    return;
  }
  console.log("[fcDailyRun]", data);
}

/** 예약 발송 실행 (매시간 cron) */
export async function runScheduledMessages(env: Env): Promise<void> {
  const db = getServiceClient(env);

  const { data, error } = await db.rpc("get_due_scheduled_messages");
  if (error) { console.error("[scheduledMsg] fetch failed:", error); return; }

  type DueMsg = {
    id: string; branch_id: string; name: string; content: string;
    channel: string; target_type: string;
    target_member_id: string | null; target_days_ahead: number | null;
  };
  const due = (data ?? []) as DueMsg[];
  if (due.length === 0) return;
  console.log("[scheduledMsg] due:", due.length);

  for (const msg of due) {
    // processing 상태로 변경
    await db.from("scheduled_messages").update({ status: "processing" }).eq("id", msg.id);

    try {
      let targets: DispatchTarget[] = [];

      if (msg.target_type === "member" && msg.target_member_id) {
        // 특정 회원
        const { data: m } = await db.from("members")
          .select("id,name,phone,branch_id,branches!inner(name)")
          .eq("id", msg.target_member_id).maybeSingle();
        type MRow = { id: string; name: string; phone: string | null; branch_id: string; branches: { name: string } };
        const mr = m as MRow | null;
        if (mr?.phone) {
          targets = [{
            member_id: mr.id, member_name: mr.name,
            branch_id: mr.branch_id, branch_name: mr.branches.name,
            member_phone: mr.phone,
          }];
        }
      } else if (msg.target_type === "group" && msg.target_days_ahead) {
        // 그룹: 만료 N일 이내
        const { data: rows } = await db.rpc("get_bulk_notification_targets", {
          _days_ahead: msg.target_days_ahead, _branch_id: msg.branch_id,
        });
        type BRow = {
          member_id: string; membership_id: string; member_name: string;
          plan_name: string; end_date: string; days_left: number;
          branch_id: string; branch_name: string; member_phone: string;
        };
        targets = ((rows ?? []) as BRow[]).map(r => ({
          member_id: r.member_id, membership_id: r.membership_id,
          member_name: r.member_name, plan_name: r.plan_name,
          end_date: r.end_date, days_left: r.days_left,
          branch_id: r.branch_id, branch_name: r.branch_name,
          member_phone: r.member_phone,
        }));
      }

      const report = await dispatchToGroup(
        db, env, targets, msg.channel as NotifyChannel, msg.content, msg.id
      );

      await db.from("scheduled_messages").update({
        status: "sent",
        sent_count: report.success,
        fail_count: report.failed,
        sent_at: new Date().toISOString(),
      }).eq("id", msg.id);

      console.log("[scheduledMsg] done:", msg.name, report);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "unknown";
      await db.from("scheduled_messages").update({
        status: "failed", error_message: errMsg,
      }).eq("id", msg.id);
      console.error("[scheduledMsg] error:", msg.name, errMsg);
    }
  }
}

export async function runDailyNotifications(env: Env): Promise<void> {
  const db = getServiceClient(env);

  // D-7 / D-3 / D-1: 기존 카카오 알림톡 로직
  const { data, error } = await db.rpc("get_expiry_notification_targets");
  if (error) { console.error("[alimtalk] target fetch failed:", error); return; }
  const targets = (data ?? []) as NotificationTarget[];
  console.log("[alimtalk] targets:", targets.length);

  if (targets.length > 0) {
    const { report, results } = await runExpiryNotifications(db, env, targets);
    console.log("[alimtalk] result:", report);

    for (const { target, result } of results) {
      await db.rpc("record_expiry_notification", {
        _member_id: target.member_id, _membership_id: target.membership_id,
        _notification_type: target.notification_type,
        _status: result.success ? "sent" : "failed",
        _error_message: result.success ? null : (result.error ?? null),
        _recipient_phone: target.member_phone ?? null,
      }).then(({ error: recErr }: { error: unknown }) => {
        if (recErr) console.error("[alimtalk] record failed:", recErr);
      });
    }
  }

  // D-0 / D+7: 지점별 notify_channel + notify_triggers 설정에 따라 SMS/카카오 발송
  await runTriggerNotifications(env, "expiry_d0");
  await runTriggerNotifications(env, "expiry_d_plus_7");
}

/** D-0 / D+7 트리거 처리 (지점별 채널 설정 반영) */
async function runTriggerNotifications(env: Env, triggerType: "expiry_d0" | "expiry_d_plus_7"): Promise<void> {
  const db = getServiceClient(env);

  const { data, error } = await db.rpc("get_expiry_trigger_targets", { _trigger_type: triggerType });
  if (error) { console.error(`[trigger:${triggerType}] fetch failed:`, error); return; }

  type TRow = {
    member_id: string; membership_id: string; member_name: string;
    plan_name: string; end_date: string; days_left: number;
    branch_id: string; branch_name: string; member_phone: string;
  };
  const rows = (data ?? []) as TRow[];
  if (rows.length === 0) return;
  console.log(`[trigger:${triggerType}] targets:`, rows.length);

  // 지점별로 그룹핑 후 지점 설정 조회
  const byBranch = new Map<string, TRow[]>();
  for (const r of rows) {
    if (!byBranch.has(r.branch_id)) byBranch.set(r.branch_id, []);
    byBranch.get(r.branch_id)!.push(r);
  }

  for (const [branchId, branchRows] of byBranch) {
    const { data: bRaw } = await db.from("branches")
      .select("notify_channel,notify_triggers")
      .eq("id", branchId).maybeSingle();
    type BranchSettings = { notify_channel: string; notify_triggers: string[] };
    const settings = bRaw as BranchSettings | null;

    const channel = (settings?.notify_channel ?? "kakao") as NotifyChannel;
    const triggers: string[] = settings?.notify_triggers ?? ["expiry_d7", "expiry_d3", "expiry_d1"];

    if (!triggers.includes(triggerType)) continue; // 해당 트리거 비활성화

    // D-0: "오늘 이용권이 만료됩니다" 기본 메시지
    // D+7: "이용권이 만료된 지 7일이 지났습니다. 재등록을 환영합니다" 기본 메시지
    const defaultContent = triggerType === "expiry_d0"
      ? `[#{지점명}] #{회원명}님, 오늘(#{만료일}) 이용권이 만료됩니다. 재등록 문의: 지점에 연락주세요.`
      : `[#{지점명}] #{회원명}님, 이용권 만료 후 7일이 지났습니다. 재등록 시 특별 혜택을 드립니다. 지점에 문의주세요.`;

    // 해당 트리거에 맞는 메시지 템플릿 조회 (없으면 기본값 사용)
    const { data: tplRaw } = await db.from("message_templates")
      .select("content")
      .eq("branch_id", branchId)
      .eq("trigger_type", triggerType)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    const content = (tplRaw as { content: string } | null)?.content ?? defaultContent;

    const dispatchTargets: DispatchTarget[] = branchRows.map(r => ({
      member_id: r.member_id, membership_id: r.membership_id,
      member_name: r.member_name, plan_name: r.plan_name,
      end_date: r.end_date, days_left: r.days_left,
      branch_id: r.branch_id, branch_name: r.branch_name,
      member_phone: r.member_phone, notification_type: triggerType,
    }));

    const report = await dispatchToGroup(db, env, dispatchTargets, channel, content);
    console.log(`[trigger:${triggerType}] branch ${branchId}:`, report);
  }
}

// ── 체험권 종료 설문 발송 (trial_end 트리거) ──────────────────
/**
 * 어제 만료된 체험권 소지자에게 설문 링크를 발송한다.
 * - trial_passes.status = 'expired' AND end_at::date = yesterday
 * - 마케팅 동의 + 전화번호 필수
 * - 지점의 trial_end 템플릿을 사용하고 #{설문링크}를 치환한다.
 *   템플릿이 없으면 기본 메시지를 사용한다.
 * - 지점의 대표 설문 QR(가장 최근 활성 QR)의 slug로 URL을 구성한다.
 */
export async function runTrialEndSurvey(env: Env): Promise<void> {
  const db = getServiceClient(env);

  // 어제 만료된 체험권 소지자 조회 (RPC)
  const { data: rows, error } = await db.rpc(
    "get_trial_end_survey_targets" as "get_survey_response_list",
    {} as unknown as { p_survey_template_id: string }
  );

  if (error) {
    console.error("[trial_end] fetch failed:", error);
    return;
  }

  type TrialRow = {
    member_id: string; member_name: string; member_phone: string;
    branch_id: string; branch_name: string;
  };
  const targets = (rows ?? []) as TrialRow[];
  if (targets.length === 0) return;

  console.log(`[trial_end] targets: ${targets.length}`);

  // 지점별 그룹핑
  const byBranch = new Map<string, TrialRow[]>();
  for (const r of targets) {
    if (!byBranch.has(r.branch_id)) byBranch.set(r.branch_id, []);
    byBranch.get(r.branch_id)!.push(r);
  }

  const surveyBase = env.PAGES_URL ?? "";

  for (const [branchId, branchRows] of byBranch) {
    // 지점 설정 + trial_end 트리거 활성화 여부 확인
    const { data: bRaw } = await db
      .from("branches")
      .select("notify_channel,notify_triggers")
      .eq("id", branchId)
      .maybeSingle();
    type BranchSettings = { notify_channel: string; notify_triggers: string[] };
    const settings = bRaw as BranchSettings | null;
    const channel = (settings?.notify_channel ?? "sms") as NotifyChannel;
    const triggers: string[] = settings?.notify_triggers ?? [];
    if (!triggers.includes("trial_end")) continue;

    // 지점의 대표 설문 QR URL 조회 (가장 최근 활성 QR)
    const { data: qrRaw } = await db
      .from("survey_qr_codes" as "members")
      .select("slug")
      .eq("branch_id" as "name", branchId)
      .eq("status" as "name", "active")
      .order("created_at" as "name", { ascending: false })
      .limit(1)
      .maybeSingle();
    const slug = (qrRaw as { slug: string } | null)?.slug ?? "";
    const surveyUrl = slug ? `${surveyBase}/s/${slug}` : "";

    // 지점 trial_end 템플릿 조회 (없으면 기본값)
    const { data: tplRaw } = await db
      .from("message_templates" as "members")
      .select("content")
      .eq("branch_id" as "name", branchId)
      .eq("trigger_type" as "name", "trial_end")
      .eq("is_active" as "name", true)
      .limit(1)
      .maybeSingle();
    const defaultContent = surveyUrl
      ? `[#{지점명}] #{회원명}님, 체험 이용이 종료되었습니다. 소중한 의견을 남겨주세요 👉 #{설문링크}`
      : `[#{지점명}] #{회원명}님, 체험 이용이 종료되었습니다. 등록 문의는 지점에 연락주세요.`;
    const content = (tplRaw as { content: string } | null)?.content ?? defaultContent;

    const dispatchTargets: DispatchTarget[] = branchRows.map(r => ({
      member_id: r.member_id, member_name: r.member_name,
      member_phone: r.member_phone, branch_id: r.branch_id,
      branch_name: r.branch_name, notification_type: "trial_end",
      survey_url: surveyUrl,
    }));

    const report = await dispatchToGroup(db, env, dispatchTargets, channel, content);
    console.log(`[trial_end] branch ${branchId}:`, report);
  }
}

// substituteVars re-export for use in other modules
export { substituteVars };

export async function runQrCleanup(env: Env): Promise<void> {
  const db = getServiceClient(env);
  const { data, error } = await db.rpc("cleanup_qr_used_tokens");
  if (error) {
    console.error("[qrCleanup]", error);
    return;
  }
  console.log("[qrCleanup] removed:", data);
}

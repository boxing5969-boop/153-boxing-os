import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../lib/env";
import { fail, ok } from "../lib/responses";
import { requireJwt } from "../middleware/jwt";
import { getServiceClient } from "../lib/supabase";
import { appendAccessLog } from "../services/auditLogger";
import {
  runNotificationsNow,
  sendMemberNotification,
  runBulkNotification,
} from "../services/manualNotifier";
import { dispatchMessage, dispatchToGroup, type NotifyChannel } from "../services/messageDispatcher";
import { getServiceClient as _getServiceClient } from "../lib/supabase";

export const adminRoutes = new Hono<{ Bindings: Env }>();

const doorOpenSchema = z.object({
  device_id: z.string().uuid(),
  reason: z.string().min(1, "사유 입력 필수"),
});

const ALLOWED_ROLES = new Set(["super_admin", "hq_admin", "branch_owner"]);

adminRoutes.post("/door/open", requireJwt, async (c) => {
  const parsed = doorOpenSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  }
  const db = getServiceClient(c.env);
  const user = c.get("user");

  const { data: profileRaw } = await db
    .from("profiles")
    .select("id,role,branch_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const profile = profileRaw as { id: string; role: string; branch_id: string | null } | null;

  if (!profile) {
    return fail(c, "PERMISSION_DENIED", "프로필을 찾을 수 없습니다", 403);
  }
  if (!ALLOWED_ROLES.has(profile.role)) {
    return fail(c, "PERMISSION_DENIED", "원격 오픈 권한이 없습니다", 403);
  }

  const { data: deviceRaw } = await db
    .from("access_devices")
    .select("id,branch_id,vendor")
    .eq("id", parsed.data.device_id)
    .maybeSingle();
  const device = deviceRaw as { id: string; branch_id: string; vendor: string } | null;
  if (!device) {
    return fail(c, "DEVICE_NOT_FOUND", "Device not found", 404);
  }

  if (profile.role === "branch_owner" && profile.branch_id !== device.branch_id) {
    return fail(c, "PERMISSION_DENIED", "다른 지점의 단말기는 제어할 수 없습니다", 403);
  }

  // 실제 device adapter.openDoor() 호출은 Phase 7 (Mock) / Phase 8 (Suprema) 에서 통합
  // Phase 4 에서는 audit log 만 기록하고 성공 응답
  const occurredAt = new Date().toISOString();
  const logId = await appendAccessLog(db, {
    branch_id: device.branch_id,
    device_id: device.id,
    member_id: null, // members FK 라 admin 의 profile.id 는 member_id 컬럼에 못 들어감
    credential_type: "admin",
    result: "success",
    raw_event_id: `admin:${profile.id}:${parsed.data.reason.slice(0, 80)}`,
    occurred_at: occurredAt,
  });

  return ok(
    c,
    {
      log_id: logId,
      device_id: device.id,
      opened_at: occurredAt,
      reason: parsed.data.reason,
    },
    "문이 열렸습니다"
  );
});


// ── Branch Kakao AlimTalk settings ──────────────────────────
const kakaoSettingsSchema = z.object({
  kakao_pfid:           z.string().min(1),
  kakao_sender_phone:   z.string().min(1),
  kakao_tpl_d7:         z.string().optional(),
  kakao_tpl_d3:         z.string().optional(),
  kakao_tpl_d1:         z.string().optional(),
  kakao_api_key:        z.string().optional(),   // plain -- encrypted on save
  kakao_api_secret:     z.string().optional(),   // plain -- encrypted on save
  kakao_enabled:        z.boolean().default(false),
});

const HQ_AND_BRANCH = new Set(["super_admin", "hq_admin", "branch_admin", "branch_owner"]);

adminRoutes.put("/branches/:id/kakao", requireJwt, async (c) => {
  const branchId = c.req.param("id");
  const parsed = kakaoSettingsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  }

  const db = getServiceClient(c.env);
  const user = c.get("user");

  const { data: profileRaw } = await db
    .from("profiles")
    .select("role, branch_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const profile = profileRaw as { role: string; branch_id: string | null } | null;
  if (!profile || !HQ_AND_BRANCH.has(profile.role)) {
    return fail(c, "PERMISSION_DENIED", "권한이 없습니다", 403);
  }
  // branch_admin can only update their own branch
  if ((profile.role === "branch_admin" || profile.role === "branch_owner") && profile.branch_id !== branchId) {
    return fail(c, "PERMISSION_DENIED", "다른 지점 설정을 변경할 수 없습니다", 403);
  }

  const { encryptDeviceKey } = await import("../lib/keyEncryption");
  const kmsKey = c.env.DEVICE_KMS_KEY;

  let apiKeyEnc: string | undefined;
  let apiSecretEnc: string | undefined;

  if (parsed.data.kakao_api_key && kmsKey) {
    apiKeyEnc = await encryptDeviceKey(kmsKey, parsed.data.kakao_api_key);
  }
  if (parsed.data.kakao_api_secret && kmsKey) {
    apiSecretEnc = await encryptDeviceKey(kmsKey, parsed.data.kakao_api_secret);
  }

  const { error } = await db.from("branches").update({
    kakao_pfid:            parsed.data.kakao_pfid,
    kakao_sender_phone:    parsed.data.kakao_sender_phone,
    kakao_tpl_d7:          parsed.data.kakao_tpl_d7 ?? null,
    kakao_tpl_d3:          parsed.data.kakao_tpl_d3 ?? null,
    kakao_tpl_d1:          parsed.data.kakao_tpl_d1 ?? null,
    kakao_api_key_enc:     apiKeyEnc,
    kakao_api_secret_enc:  apiSecretEnc,
    kakao_enabled:         parsed.data.kakao_enabled,
  }).eq("id", branchId);

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { branch_id: branchId }, "카카오 알림톡 설정이 저장되었습니다");
});

// ── 즉시 발송: 오늘의 자동 알림 대상 즉시 실행 ──────────────
adminRoutes.post("/kakao/run-now", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const user = c.get("user");
  const { data: profileRaw } = await db
    .from("profiles").select("role")
    .eq("auth_user_id", user.id).maybeSingle();
  const profile = profileRaw as { role: string } | null;
  if (!profile || !HQ_AND_BRANCH.has(profile.role)) {
    return fail(c, "PERMISSION_DENIED", "권한이 없습니다", 403);
  }
  try {
    const report = await runNotificationsNow(db, c.env);
    return ok(c, report, `발송 완료: 성공 ${report.sent}건 / 실패 ${report.failed}건 / 스킵 ${report.skipped}건`);
  } catch (err) {
    return fail(c, "SEND_ERROR", err instanceof Error ? err.message : "발송 오류", 500);
  }
});

// ── 회원 개별 발송 ─────────────────────────────────────────
adminRoutes.post("/members/:id/notify", requireJwt, async (c) => {
  const memberId = c.req.param("id");
  const db = getServiceClient(c.env);
  const user = c.get("user");
  const { data: profileRaw } = await db
    .from("profiles").select("role")
    .eq("auth_user_id", user.id).maybeSingle();
  const profile = profileRaw as { role: string } | null;
  if (!profile || !HQ_AND_BRANCH.has(profile.role)) {
    return fail(c, "PERMISSION_DENIED", "권한이 없습니다", 403);
  }
  try {
    const result = await sendMemberNotification(db, c.env, memberId);
    if (!result.success) {
      return fail(c, "SEND_FAILED", result.error ?? "발송 실패", 400);
    }
    return ok(c, result, `${result.member_name}님께 알림톡을 발송했습니다`);
  } catch (err) {
    return fail(c, "SEND_ERROR", err instanceof Error ? err.message : "발송 오류", 500);
  }
});

// ── 그룹 발송 ─────────────────────────────────────────────
const bulkNotifySchema = z.object({
  days_ahead: z.number().int().min(1).max(90),
  branch_id:  z.string().uuid().optional(),
  dry_run:    z.boolean().default(false),
});

adminRoutes.post("/notify/bulk", requireJwt, async (c) => {
  const parsed = bulkNotifySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  }
  const db = getServiceClient(c.env);
  const user = c.get("user");
  const { data: profileRaw } = await db
    .from("profiles").select("role")
    .eq("auth_user_id", user.id).maybeSingle();
  const profile = profileRaw as { role: string } | null;
  if (!profile || !HQ_AND_BRANCH.has(profile.role)) {
    return fail(c, "PERMISSION_DENIED", "권한이 없습니다", 403);
  }
  try {
    const result = await runBulkNotification(db, c.env, parsed.data);
    const msg = parsed.data.dry_run
      ? `발송 예정 인원: ${result.targets_count}명`
      : `발송 완료: 성공 ${result.report?.sent ?? 0}건 / 실패 ${result.report?.failed ?? 0}건`;
    return ok(c, result, msg);
  } catch (err) {
    return fail(c, "SEND_ERROR", err instanceof Error ? err.message : "발송 오류", 500);
  }
});

// ── 채널 선택 포함 회원 개별 발송 ────────────────────────────
const memberSendSchema = z.object({
  channel: z.enum(["sms", "kakao", "both", "kakao_sms_fallback"]).default("sms"),
  content: z.string().optional(),
});

adminRoutes.post("/members/:id/send", requireJwt, async (c) => {
  const memberId = c.req.param("id");
  const parsed = memberSendSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "Invalid body", 400);

  const db = getServiceClient(c.env);
  const user = c.get("user");
  const { data: profileRaw } = await db.from("profiles").select("role").eq("auth_user_id", user.id).maybeSingle();
  const profile = profileRaw as { role: string } | null;
  if (!profile || !HQ_AND_BRANCH.has(profile.role)) return fail(c, "PERMISSION_DENIED", "권한이 없습니다", 403);

  // 회원 정보 조회
  const { data: memberRaw } = await db.from("members")
    .select("id,name,phone,branch_id,branches!inner(name)")
    .eq("id", memberId).maybeSingle();
  type MemberRow = { id: string; name: string; phone: string | null; branch_id: string; branches: { name: string } };
  const member = memberRaw as MemberRow | null;
  if (!member) return fail(c, "NOT_FOUND", "회원을 찾을 수 없습니다", 404);
  if (!member.phone) return fail(c, "NO_PHONE", "전화번호가 없습니다", 400);

  // 마케팅 동의 확인
  const { data: consentRaw } = await db.from("consent_records")
    .select("id").eq("member_id", memberId).eq("consent_type", "marketing")
    .eq("agreed", true).is("revoked_at", null).maybeSingle();
  if (!consentRaw) return fail(c, "NO_CONSENT", "마케팅 수신 동의를 받지 않은 회원입니다", 400);

  // 활성 이용권 조회
  const today = new Date().toISOString().slice(0, 10);
  const { data: msRaw } = await db.from("memberships")
    .select("id,plan_name,end_date")
    .eq("member_id", memberId).eq("status", "active")
    .in("payment_status", ["paid", "partial"])
    .gte("end_date", today).order("end_date").limit(1).maybeSingle();
  type MsRow = { id: string; plan_name: string; end_date: string };
  const ms = msRaw as MsRow | null;

  const daysLeft = ms ? Math.max(0, Math.floor(
    (new Date(ms.end_date).getTime() - new Date(today).getTime()) / 86400000
  )) : 0;
  const notifType = daysLeft <= 1 ? "expiry_d1" : daysLeft <= 3 ? "expiry_d3" : "expiry_d7";

  const defaultContent = `[#{지점명}] #{회원명}님, 이용권이 #{남은일수}일 후(#{만료일}) 만료됩니다.`;
  const content = parsed.data.content ?? defaultContent;

  const result = await dispatchMessage(db, c.env, {
    member_id: member.id, membership_id: ms?.id,
    member_name: member.name, plan_name: ms?.plan_name,
    end_date: ms?.end_date, days_left: daysLeft,
    branch_id: member.branch_id, branch_name: member.branches.name,
    member_phone: member.phone, notification_type: notifType,
  }, parsed.data.channel as NotifyChannel, content);

  if (!result.overall_success) {
    const errMsg = result.sms?.error ?? result.kakao?.error ?? "발송 실패";
    return fail(c, "SEND_FAILED", errMsg, 400);
  }
  return ok(c, result, `${member.name}님께 발송했습니다`);
});

// ── 채널 선택 포함 그룹 발송 ──────────────────────────────
const bulkMsgSchema = z.object({
  days_ahead: z.number().int().min(1).max(90),
  channel: z.enum(["sms", "kakao", "both", "kakao_sms_fallback"]).default("sms"),
  content: z.string().min(1),
  branch_id: z.string().uuid().optional(),
  dry_run: z.boolean().default(false),
});

adminRoutes.post("/notify/bulk-msg", requireJwt, async (c) => {
  const parsed = bulkMsgSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);

  const db = getServiceClient(c.env);
  const user = c.get("user");
  const { data: profileRaw } = await db.from("profiles").select("role").eq("auth_user_id", user.id).maybeSingle();
  const profile = profileRaw as { role: string } | null;
  if (!profile || !HQ_AND_BRANCH.has(profile.role)) return fail(c, "PERMISSION_DENIED", "권한이 없습니다", 403);

  const { data: rows } = await db.rpc("get_bulk_notification_targets", {
    _days_ahead: parsed.data.days_ahead, _branch_id: parsed.data.branch_id ?? null,
  });
  const targets = ((rows ?? []) as Array<{
    member_id: string; membership_id: string; member_name: string; plan_name: string;
    end_date: string; days_left: number; branch_id: string; branch_name: string; member_phone: string;
  }>).map(r => ({
    member_id: r.member_id, membership_id: r.membership_id,
    member_name: r.member_name, plan_name: r.plan_name,
    end_date: r.end_date, days_left: r.days_left,
    branch_id: r.branch_id, branch_name: r.branch_name,
    member_phone: r.member_phone,
  }));

  if (parsed.data.dry_run) return ok(c, { targets_count: targets.length }, `발송 예정: ${targets.length}명`);

  const report = await dispatchToGroup(db, c.env, targets, parsed.data.channel as NotifyChannel, parsed.data.content);
  return ok(c, { targets_count: targets.length, report }, `발송 완료: 성공 ${report.success}건`);
});

// ── 회원 공지 발송 (상태별 전체 발송) ────────────────────────
const broadcastSchema = z.object({
  channel: z.enum(["sms", "kakao", "both", "kakao_sms_fallback"]).default("kakao"),
  content: z.string().min(1, "메시지 내용을 입력하세요"),
  target_statuses: z.array(z.string()).default(["active", "trial"]),
  branch_id: z.string().uuid().optional(),
  dry_run: z.boolean().default(false),
});

adminRoutes.post("/notify/broadcast", requireJwt, async (c) => {
  const parsed = broadcastSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);

  const db = getServiceClient(c.env);
  const user = c.get("user");
  const { data: profileRaw } = await db.from("profiles").select("role,branch_id").eq("auth_user_id", user.id).maybeSingle();
  const profile = profileRaw as { role: string; branch_id: string | null } | null;
  if (!profile || !HQ_AND_BRANCH.has(profile.role)) return fail(c, "PERMISSION_DENIED", "권한이 없습니다", 403);

  // 지점 필터: branch_owner는 자기 지점만
  const effectiveBranchId = (profile.role === "branch_owner" || profile.role === "branch_manager")
    ? profile.branch_id
    : (parsed.data.branch_id ?? null);

  // 대상 회원 조회: 상태 + 마케팅 동의 + 전화번호 존재
  let query = db
    .from("members")
    .select("id, name, phone, branch_id, branches(name)")
    .in("status", parsed.data.target_statuses)
    .not("phone", "is", null);

  if (effectiveBranchId) query = query.eq("branch_id", effectiveBranchId);

  const { data: memberRows, error: memberErr } = await query;
  if (memberErr) return fail(c, "DB_ERROR", memberErr.message, 500);

  // 마케팅 동의 회원 ID 목록
  const memberIds = (memberRows ?? []).map((m: Record<string, unknown>) => m.id as string);
  const { data: consentRows } = await db
    .from("consent_records")
    .select("member_id")
    .in("member_id", memberIds.length > 0 ? memberIds : ["_"])
    .eq("consent_type", "marketing")
    .eq("agreed", true)
    .is("revoked_at", null);

  const consentSet = new Set((consentRows ?? []).map((r: Record<string, unknown>) => r.member_id as string));

  type MemberRow = { id: string; name: string; phone: string | null; branch_id: string; branches: { name: string } | null };
  const targets = (memberRows ?? [] as MemberRow[])
    .filter((m: MemberRow) => m.phone && consentSet.has(m.id))
    .map((m: MemberRow) => ({
      member_id: m.id,
      member_name: m.name,
      member_phone: m.phone as string,
      branch_id: m.branch_id,
      branch_name: (m.branches as { name: string } | null)?.name ?? "",
      membership_id: "",
      plan_name: "",
      end_date: "",
      days_left: 0,
      notification_type: "broadcast",
    }));

  if (parsed.data.dry_run) {
    return ok(c, { targets_count: targets.length }, `발송 예정: ${targets.length}명`);
  }

  const report = await dispatchToGroup(db, c.env, targets, parsed.data.channel as NotifyChannel, parsed.data.content);
  return ok(c, { targets_count: targets.length, report }, `발송 완료: 성공 ${report.success}건`);
});

// ── 지점 알림 설정 저장 ───────────────────────────────────
const notifySettingsSchema = z.object({
  notify_channel:  z.enum(["sms","kakao","both","kakao_sms_fallback"]).optional(),
  notify_triggers: z.array(z.string()).optional(),
  sms_sender_phone: z.string().optional(),
});

adminRoutes.put("/branches/:id/notify-settings", requireJwt, async (c) => {
  const branchId = c.req.param("id");
  const parsed = notifySettingsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "Invalid body", 400);

  const db = getServiceClient(c.env);
  const user = c.get("user");
  const { data: profileRaw } = await db.from("profiles").select("role,branch_id").eq("auth_user_id", user.id).maybeSingle();
  const profile = profileRaw as { role: string; branch_id: string | null } | null;
  if (!profile || !HQ_AND_BRANCH.has(profile.role)) return fail(c, "PERMISSION_DENIED", "권한이 없습니다", 403);
  if ((profile.role === "branch_owner" || profile.role === "branch_admin") && profile.branch_id !== branchId) {
    return fail(c, "PERMISSION_DENIED", "다른 지점 설정을 변경할 수 없습니다", 403);
  }

  const { error } = await db.from("branches").update({
    ...(parsed.data.notify_channel   !== undefined && { notify_channel:   parsed.data.notify_channel }),
    ...(parsed.data.notify_triggers  !== undefined && { notify_triggers:  parsed.data.notify_triggers }),
    ...(parsed.data.sms_sender_phone !== undefined && { sms_sender_phone: parsed.data.sms_sender_phone }),
  }).eq("id", branchId);

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { branch_id: branchId }, "알림 설정이 저장되었습니다");
});

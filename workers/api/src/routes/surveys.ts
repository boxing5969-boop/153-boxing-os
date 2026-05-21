/**
 * 설문 발송 API
 *   POST /api/admin/surveys/send
 *     회원에게 개인 설문 링크를 SMS/카카오로 발송한다.
 *
 * 인증 : Supabase JWT (super_admin / hq_admin / branch_owner / branch_manager)
 * 권한 : 지점 관리자는 자기 지점 설문만 발송 가능
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../lib/env";
import { fail, ok } from "../lib/responses";
import { requireJwt } from "../middleware/jwt";
import { getServiceClient } from "../lib/supabase";
import { dispatchSurveyInvitations, type SurveyChannel } from "../services/surveyDispatcher";

export const surveysRoutes = new Hono<{ Bindings: Env }>();

const HQ_AND_BRANCH = new Set(["super_admin", "hq_admin", "branch_owner", "branch_manager"]);
const BRANCH_SCOPED = new Set(["branch_owner", "branch_manager"]);

const sendSchema = z.object({
  qr_code_id: z.string().uuid(),
  member_ids: z.array(z.string().uuid()).min(1, "대상 회원을 선택하세요").max(1000),
  channel: z.enum(["sms", "kakao", "both", "kakao_sms_fallback", "app_push", "email", "manual"]).default("sms"),
  content: z.string().min(1, "메시지 내용을 입력하세요"),
  dry_run: z.boolean().default(false),
});

surveysRoutes.post("/send", requireJwt, async (c) => {
  const parsed = sendSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  }

  // 설문 링크 누락 방어 — 자동 발송 채널은 본문에 #{설문링크} 치환자가 반드시 있어야 한다.
  // 없으면 링크 없는 문자가 발송되어 발송 비용만 나가고 회원은 설문에 접근할 수 없다.
  // (프론트 검증만으로는 API 직접 호출·우회 시 막지 못하므로 서버에서 한 번 더 막는다.)
  if (parsed.data.channel !== "manual" && !parsed.data.content.includes("#{설문링크}")) {
    return fail(c, "INVALID_REQUEST", "메시지 본문에 #{설문링크} 를 포함해야 합니다", 400);
  }

  const db = getServiceClient(c.env);
  const user = c.get("user");

  // 1. 호출자 권한 확인
  const { data: profileRaw } = await db
    .from("profiles")
    .select("id,role,branch_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const profile = profileRaw as { id: string; role: string; branch_id: string | null } | null;
  if (!profile || !HQ_AND_BRANCH.has(profile.role)) {
    return fail(c, "PERMISSION_DENIED", "권한이 없습니다", 403);
  }

  // 2. QR 코드 조회 + 검증
  const { data: qrRaw } = await db
    .from("survey_qr_codes")
    .select("id,slug,branch_id,survey_template_id,status")
    .eq("id", parsed.data.qr_code_id)
    .maybeSingle();
  const qr = qrRaw as {
    id: string; slug: string; branch_id: string;
    survey_template_id: string; status: string;
  } | null;
  if (!qr) return fail(c, "NOT_FOUND", "설문 QR을 찾을 수 없습니다", 404);
  if (qr.status !== "active") return fail(c, "QR_INACTIVE", "비활성 상태의 설문 링크입니다", 400);

  // 3. 지점 권한 확인 — 지점 관리자는 자기 지점만
  if (BRANCH_SCOPED.has(profile.role) && profile.branch_id !== qr.branch_id) {
    return fail(c, "PERMISSION_DENIED", "다른 지점의 설문은 발송할 수 없습니다", 403);
  }

  // 4. 템플릿 상태 확인
  const { data: tmplRaw } = await db
    .from("survey_templates")
    .select("title,status")
    .eq("id", qr.survey_template_id)
    .maybeSingle();
  const tmpl = tmplRaw as { title: string; status: string } | null;
  if (!tmpl || tmpl.status !== "active") {
    return fail(c, "SURVEY_INACTIVE", "비활성 상태의 설문입니다", 400);
  }

  // 5. 지점명 조회
  const { data: branchRaw } = await db
    .from("branches")
    .select("name")
    .eq("id", qr.branch_id)
    .maybeSingle();
  const branchName = (branchRaw as { name: string } | null)?.name ?? "153 Boxing";

  // 6. 대상 회원 조회 (QR 지점 소속만 허용)
  const { data: memberRows, error: memberErr } = await db
    .from("members")
    .select("id,name,phone,branch_id")
    .in("id", parsed.data.member_ids)
    .eq("branch_id", qr.branch_id);
  if (memberErr) return fail(c, "DB_ERROR", memberErr.message, 500);

  const members = ((memberRows ?? []) as Array<{
    id: string; name: string; phone: string | null; branch_id: string;
  }>).map((m) => ({ id: m.id, name: m.name, phone: m.phone }));

  if (members.length === 0) {
    return fail(c, "NO_TARGETS", "발송 대상 회원이 없습니다 (지점이 다르거나 존재하지 않음)", 400);
  }

  // 7. dry_run — 실제 발송 없이 대상 수만 반환
  if (parsed.data.dry_run) {
    return ok(c, { targets_count: members.length }, `발송 예정: ${members.length}명`);
  }

  // 8. 공개 설문 베이스 URL
  const baseUrl = c.env.PAGES_URL ?? "";
  if (!baseUrl) {
    return fail(c, "CONFIG_ERROR", "PAGES_URL 미설정 — 설문 링크를 생성할 수 없습니다", 500);
  }

  // 9. 발송
  const report = await dispatchSurveyInvitations(db, c.env, {
    qr_code_id: qr.id,
    slug: qr.slug,
    survey_template_id: qr.survey_template_id,
    branch_id: qr.branch_id,
    branch_name: branchName,
    channel: parsed.data.channel as SurveyChannel,
    content: parsed.data.content,
    base_url: baseUrl,
    created_by: profile.id,
    members,
  });

  const msg = `설문 발송 완료: 성공 ${report.sent}건 / 실패 ${report.failed}건`
    + (report.skipped > 0 ? ` / 링크생성 ${report.skipped}건` : "");
  return ok(c, report, msg);
});

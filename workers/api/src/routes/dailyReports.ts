/**
 * 일일 경영 성과 리포트 API (/api/reports)
 *
 * - 모든 읽기/쓰기는 Workers(service_role) 경유. 응답 형식 { success, data, message? }.
 * - 권한:
 *   - 작성·수정: branch_owner / branch_manager(자기 지점) + super_admin / hq_admin(전 지점)
 *   - 조회: 위와 동일 (HQ 는 전 지점)
 *   - 월 목표 설정: super_admin / hq_admin (본사)
 * - 수정 허용 기간: report_date 가 KST 기준 오늘 또는 어제일 때만.
 * - 자동계산(당일/월누적/달성률/Gap/D-Day)은 서버에서 계산해 summary 로 내려준다.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../lib/env";
import { fail, ok } from "../lib/responses";
import { requireJwt } from "../middleware/jwt";
import { getServiceClient } from "../lib/supabase";

export const dailyReportsRoutes = new Hono<{ Bindings: Env }>();

const HQ_ROLES = new Set(["super_admin", "hq_admin"]);
const WRITE_ROLES = new Set(["super_admin", "hq_admin", "branch_owner", "branch_manager"]);

interface ProfileRow {
  id: string;
  role: string;
  branch_id: string | null;
}

async function getProfile(db: SupabaseClient, authUserId: string): Promise<ProfileRow | null> {
  const { data } = await db
    .from("profiles")
    .select("id, role, branch_id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  return (data as ProfileRow | null) ?? null;
}

function canAccessBranch(profile: ProfileRow, branchId: string): boolean {
  return HQ_ROLES.has(profile.role) || profile.branch_id === branchId;
}

/** KST(UTC+9) 기준 YYYY-MM-DD */
function kstDateStr(d: Date = new Date()): string {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 작성일 당일 + 익일까지만 수정 허용 */
function isWithinEditWindow(reportDate: string): boolean {
  const today = kstDateStr();
  return reportDate === today || reportDate === addDays(today, -1);
}

interface RevenueRow {
  report_date: string;
  revenue_pt: number;
  revenue_membership: number;
  revenue_goods: number;
  revenue_dan: number;
}

function rowTotal(r: RevenueRow): number {
  return r.revenue_pt + r.revenue_membership + r.revenue_goods + r.revenue_dan;
}

async function computeSummary(db: SupabaseClient, branchId: string, date: string) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const ym = date.slice(0, 7);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthStart = `${ym}-01`;
  const monthEnd = `${ym}-${String(lastDay).padStart(2, "0")}`;

  const { data: rowsRaw } = await db
    .from("daily_reports")
    .select("report_date,revenue_pt,revenue_membership,revenue_goods,revenue_dan")
    .eq("branch_id", branchId)
    .gte("report_date", monthStart)
    .lte("report_date", monthEnd);
  const rows = (rowsRaw as RevenueRow[] | null) ?? [];

  const cumulative = rows.reduce((s, r) => s + rowTotal(r), 0);
  const dayRow = rows.find((r) => r.report_date === date);
  const dayTotal = dayRow ? rowTotal(dayRow) : 0;

  const { data: tgt } = await db
    .from("monthly_targets")
    .select("target_amount")
    .eq("branch_id", branchId)
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();
  const target = Number((tgt as { target_amount: number } | null)?.target_amount ?? 0);

  return {
    day_total: dayTotal,
    month_cumulative: cumulative,
    target_amount: target,
    achievement: target > 0 ? cumulative / target : null, // 0 나눗셈 방지
    gap: target - cumulative,
    d_day: lastDay - Number(date.slice(8, 10)),
  };
}

// ── 폼 로드: 리포트 + 체크리스트 + 요약 ──────────────────────
dailyReportsRoutes.get("/daily", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id");
  const date = c.req.query("date") ?? kstDateStr();
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);

  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);

  const [{ data: report }, { data: checklist }, summary] = await Promise.all([
    db.from("daily_reports").select("*").eq("branch_id", branchId).eq("report_date", date).maybeSingle(),
    db.from("daily_checklists").select("*").eq("branch_id", branchId).eq("report_date", date).maybeSingle(),
    computeSummary(db, branchId, date),
  ]);

  return ok(c, {
    report: report ?? null,
    checklist: checklist ?? null,
    summary,
    editable: isWithinEditWindow(date) && WRITE_ROLES.has(profile.role) && canAccessBranch(profile, branchId),
  });
});

// ── 일일 리포트 저장 (upsert, 하루 1건) ──────────────────────
const reportSchema = z.object({
  branch_id: z.string().uuid(),
  report_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  revenue_pt: z.number().int().min(0).default(0),
  revenue_membership: z.number().int().min(0).default(0),
  revenue_goods: z.number().int().min(0).default(0),
  revenue_dan: z.number().int().min(0).default(0),
  inquiry_count: z.number().int().min(0).default(0),
  new_signups: z.number().int().min(0).default(0),
  re_signups: z.number().int().min(0).default(0),
  pending_count: z.number().int().min(0).default(0),
  pipeline_action_plan: z.string().nullish(),
  morning_attendance: z.number().int().min(0).default(0),
  lunch_attendance: z.number().int().min(0).default(0),
  evening_attendance: z.number().int().min(0).default(0),
  morning_note: z.string().nullish(),
  lunch_note: z.string().nullish(),
  evening_note: z.string().nullish(),
  inactive_contacted: z.number().int().min(0).default(0),
  inactive_reached: z.number().int().min(0).default(0),
  inactive_returned: z.number().int().min(0).default(0),
  promotion_candidates: z.string().nullish(),
  facility_issue: z.string().nullish(),
  decision_issue: z.string().nullish(),
  decision_proposal: z.string().nullish(),
  decision_request: z.string().nullish(),
});

dailyReportsRoutes.put("/daily", requireJwt, async (c) => {
  const parsed = reportSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, parsed.data.branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 수정할 수 없습니다", 403);
  if (!isWithinEditWindow(parsed.data.report_date)) return fail(c, "EDIT_WINDOW", "작성일 당일·익일까지만 수정할 수 있습니다", 400);

  const { error } = await db.from("daily_reports").upsert(
    { ...parsed.data, author_profile_id: profile.id, updated_at: new Date().toISOString() },
    { onConflict: "branch_id,report_date" },
  );
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { branch_id: parsed.data.branch_id, report_date: parsed.data.report_date }, "저장되었습니다");
});

// ── 체크리스트 저장 (upsert) ─────────────────────────────────
const checklistSchema = z.object({
  branch_id: z.string().uuid(),
  report_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(
    z.object({
      no: z.number().int(),
      label: z.string(),
      done: z.boolean(),
      memo: z.string().default(""),
    }),
  ),
});

dailyReportsRoutes.put("/checklist", requireJwt, async (c) => {
  const parsed = checklistSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, parsed.data.branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 수정할 수 없습니다", 403);
  if (!isWithinEditWindow(parsed.data.report_date)) return fail(c, "EDIT_WINDOW", "작성일 당일·익일까지만 수정할 수 있습니다", 400);

  const { error } = await db.from("daily_checklists").upsert(
    {
      branch_id: parsed.data.branch_id,
      report_date: parsed.data.report_date,
      items: parsed.data.items,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "branch_id,report_date" },
  );
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { branch_id: parsed.data.branch_id }, "체크리스트가 저장되었습니다");
});

// ── 월 목표 설정 (본사 전용) ─────────────────────────────────
const targetSchema = z.object({
  branch_id: z.string().uuid(),
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  target_amount: z.number().int().min(0),
});

dailyReportsRoutes.put("/monthly-target", requireJwt, async (c) => {
  const parsed = targetSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !HQ_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "월 목표는 본사만 설정할 수 있습니다", 403);

  const { error } = await db.from("monthly_targets").upsert(
    { ...parsed.data, updated_at: new Date().toISOString() },
    { onConflict: "branch_id,year,month" },
  );
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, parsed.data, "월 목표가 저장되었습니다");
});

// ── 월간 추이 (스택 차트용) ──────────────────────────────────
dailyReportsRoutes.get("/trend", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id");
  const year = Number(c.req.query("year"));
  const month = Number(c.req.query("month"));
  if (!branchId || !year || !month) return fail(c, "INVALID_REQUEST", "branch_id, year, month 필수", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);

  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const { data } = await db
    .from("daily_reports")
    .select("report_date,revenue_pt,revenue_membership,revenue_goods,revenue_dan")
    .eq("branch_id", branchId)
    .gte("report_date", `${year}-${mm}-01`)
    .lte("report_date", `${year}-${mm}-${String(lastDay).padStart(2, "0")}`)
    .order("report_date");
  return ok(c, { rows: (data as RevenueRow[] | null) ?? [] });
});

// ── 대표용 전 지점 개요 (본사 전용) ──────────────────────────
interface BranchRow {
  id: string;
  name: string;
}

dailyReportsRoutes.get("/overview", requireJwt, async (c) => {
  const date = c.req.query("date") ?? kstDateStr();
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !HQ_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "본사 전용입니다", 403);

  const { data: branchesRaw } = await db.from("branches").select("id,name").order("name");
  const branches = (branchesRaw as BranchRow[] | null) ?? [];
  const items = await Promise.all(
    branches.map(async (b) => {
      const s = await computeSummary(db, b.id, date);
      return { branch_id: b.id, branch_name: b.name, ...s };
    }),
  );
  return ok(c, { date, branches: items });
});

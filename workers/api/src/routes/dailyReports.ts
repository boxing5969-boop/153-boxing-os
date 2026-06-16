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
import {
  generateTasks, generateAlerts, computeScore,
  type OpsInput, type ReportIn, type FollowupIn, type PtIn, type RefundIn, type LeadIn, type SnapshotIn, type IssueIn,
} from "../lib/autoOps";

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
    .select("id, role, branch_id, status")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  const p = data as (ProfileRow & { status?: string }) | null;
  return p && p.status === "active" ? p : null; // 승인(active) 계정만 허용
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
  refund_amount: number;
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
    .select("report_date,revenue_pt,revenue_membership,revenue_goods,revenue_dan,refund_amount")
    .eq("branch_id", branchId)
    .gte("report_date", monthStart)
    .lte("report_date", monthEnd);
  const rows = (rowsRaw as RevenueRow[] | null) ?? [];

  const cumulative = rows.reduce((s, r) => s + rowTotal(r), 0);
  const refundTotal = rows.reduce((s, r) => s + (r.refund_amount ?? 0), 0);
  const netCumulative = cumulative - refundTotal;
  const dayRow = rows.find((r) => r.report_date === date);
  const dayTotal = dayRow ? rowTotal(dayRow) : 0;
  const dayRefund = dayRow ? dayRow.refund_amount ?? 0 : 0;

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
    day_refund: dayRefund,
    day_net: dayTotal - dayRefund,
    month_cumulative: cumulative,
    refund_total: refundTotal,
    net_cumulative: netCumulative,
    target_amount: target,
    achievement: target > 0 ? netCumulative / target : null, // 0 나눗셈 방지, 순매출 기준
    gap: target - netCumulative,
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
  refund_count: z.number().int().min(0).default(0),
  refund_amount: z.number().int().min(0).default(0),
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
      label: z.string().optional(),
      done: z.boolean().default(false),
      actual: z.number().int().min(0).default(0),
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

// ── 체크리스트 이력 (꾸준함 통계용) ───────────────────────────
dailyReportsRoutes.get("/checklist-history", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id");
  const days = Math.min(Math.max(Number(c.req.query("days")) || 40, 1), 95);
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);

  const from = addDays(kstDateStr(), -days);
  const { data } = await db
    .from("daily_checklists")
    .select("report_date, items")
    .eq("branch_id", branchId)
    .gte("report_date", from)
    .order("report_date");
  return ok(c, { rows: (data as { report_date: string; items: unknown }[] | null) ?? [] });
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

// ── 월간 종합 (지점 한 달 전체 데이터) ───────────────────────
interface MonthRep {
  report_date: string;
  revenue_pt: number; revenue_membership: number; revenue_goods: number; revenue_dan: number;
  refund_amount: number; refund_count: number;
  inquiry_count: number; new_signups: number; re_signups: number; pending_count: number;
  morning_attendance: number; lunch_attendance: number; evening_attendance: number;
}
dailyReportsRoutes.get("/month-summary", requireJwt, async (c) => {
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
  const start = `${year}-${mm}-01`;
  const end = `${year}-${mm}-${String(lastDay).padStart(2, "0")}`;

  const [{ data: repRaw }, { data: tgt }, { data: clRaw }, { data: fuRaw }] = await Promise.all([
    db.from("daily_reports").select("*").eq("branch_id", branchId).gte("report_date", start).lte("report_date", end).order("report_date"),
    db.from("monthly_targets").select("target_amount").eq("branch_id", branchId).eq("year", year).eq("month", month).maybeSingle(),
    db.from("daily_checklists").select("report_date,items").eq("branch_id", branchId).gte("report_date", start).lte("report_date", end),
    db.from("member_followups").select("status,created_at").eq("branch_id", branchId).gte("created_at", `${start}T00:00:00Z`).lte("created_at", `${end}T23:59:59Z`),
  ]);

  const reps = (repRaw as MonthRep[] | null) ?? [];
  const sum = (f: (r: MonthRep) => number): number => reps.reduce((s, r) => s + f(r), 0);
  const gross = sum((r) => r.revenue_pt + r.revenue_membership + r.revenue_goods + r.revenue_dan);
  const refund = sum((r) => r.refund_amount ?? 0);
  const net = gross - refund;
  const target = Number((tgt as { target_amount: number } | null)?.target_amount ?? 0);

  const careNos = [1, 2, 3];
  let care = 0;
  for (const row of (clRaw as { items: { no: number; actual?: number }[] }[] | null) ?? []) {
    for (const it of row.items ?? []) if (careNos.includes(it.no)) care += it.actual ?? 0;
  }

  const fu = (fuRaw as { status: string }[] | null) ?? [];
  const fuBy = (st: string): number => fu.filter((x) => x.status === st).length;

  const daily = reps.map((r) => ({
    date: r.report_date,
    net: r.revenue_pt + r.revenue_membership + r.revenue_goods + r.revenue_dan - (r.refund_amount ?? 0),
  }));

  return ok(c, {
    year, month,
    revenue: { pt: sum((r) => r.revenue_pt), membership: sum((r) => r.revenue_membership), goods: sum((r) => r.revenue_goods), dan: sum((r) => r.revenue_dan) },
    gross, refund, refund_count: sum((r) => r.refund_count ?? 0), net,
    target, achievement: target > 0 ? net / target : null, gap: target - net,
    pipeline: { inquiry: sum((r) => r.inquiry_count), new_signups: sum((r) => r.new_signups), re_signups: sum((r) => r.re_signups), pending: sum((r) => r.pending_count) },
    attendance_avg: reps.length ? Math.round(sum((r) => r.morning_attendance + r.lunch_attendance + r.evening_attendance) / reps.length) : 0,
    member_care: care,
    followups: { extended: fuBy("연장"), hold: fuBy("보류"), failed: fuBy("실패"), ongoing: fuBy("진행중") },
    days_reported: reps.length,
    daily,
  });
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

// ── 만료 임박 팔로업 보드 ───────────────────────────────────
interface FollowupRow {
  id: string;
  branch_id: string;
  member_name: string;
  expire_date: string | null;
  met_inperson: boolean;
  called: boolean;
  texted: boolean;
  status: string;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

dailyReportsRoutes.get("/followups", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id");
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data } = await db
    .from("member_followups")
    .select("*")
    .eq("branch_id", branchId)
    .order("created_at", { ascending: false });
  return ok(c, { followups: (data as FollowupRow[] | null) ?? [] });
});

const followupCreateSchema = z.object({
  branch_id: z.string().uuid(),
  member_name: z.string().min(1, "이름을 입력하세요"),
  expire_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});
dailyReportsRoutes.post("/followups", requireJwt, async (c) => {
  const parsed = followupCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, parsed.data.branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 수정할 수 없습니다", 403);
  const { data, error } = await db
    .from("member_followups")
    .insert({
      branch_id: parsed.data.branch_id,
      member_name: parsed.data.member_name,
      expire_date: parsed.data.expire_date ?? null,
      created_by: profile.id,
    })
    .select()
    .maybeSingle();
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data, "추가되었습니다");
});

const followupUpdateSchema = z.object({
  met_inperson: z.boolean().optional(),
  called: z.boolean().optional(),
  texted: z.boolean().optional(),
  status: z.enum(["진행중", "연장", "보류", "실패"]).optional(),
  memo: z.string().nullish(),
});
dailyReportsRoutes.put("/followups/:id", requireJwt, async (c) => {
  const id = c.req.param("id");
  const parsed = followupUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "Invalid body", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data: row } = await db.from("member_followups").select("branch_id").eq("id", id).maybeSingle();
  if (!row) return fail(c, "NOT_FOUND", "대상을 찾을 수 없습니다", 404);
  if (!canAccessBranch(profile, (row as { branch_id: string }).branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 수정할 수 없습니다", 403);
  const { error } = await db
    .from("member_followups")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { id }, "저장되었습니다");
});

dailyReportsRoutes.delete("/followups/:id", requireJwt, async (c) => {
  const id = c.req.param("id");
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data: row } = await db.from("member_followups").select("branch_id").eq("id", id).maybeSingle();
  if (!row) return fail(c, "NOT_FOUND", "대상을 찾을 수 없습니다", 404);
  if (!canAccessBranch(profile, (row as { branch_id: string }).branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 수정할 수 없습니다", 403);
  const { error } = await db.from("member_followups").delete().eq("id", id);
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { id }, "삭제되었습니다");
});

// ── 매출 등록 (수강권·물품·단증) ─────────────────────────────
interface SalesRow {
  id: string; branch_id: string; sale_date: string; member_name: string;
  category: string; product: string; is_new: boolean; payment_method: string; amount: number;
}
dailyReportsRoutes.get("/sales", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id");
  const date = c.req.query("date") ?? kstDateStr();
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data } = await db.from("sales_entries").select("*").eq("branch_id", branchId).eq("sale_date", date).order("created_at", { ascending: false });
  return ok(c, { sales: (data as SalesRow[] | null) ?? [] });
});

const salesCreateSchema = z.object({
  branch_id: z.string().uuid(),
  sale_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  member_name: z.string().min(1, "이름을 입력하세요"),
  category: z.enum(["수강권", "물품", "단증"]),
  product: z.string().min(1),
  is_new: z.boolean().default(true),
  payment_method: z.enum(["현금", "카드", "계좌이체"]),
  amount: z.number().int().min(0).default(0),
});
dailyReportsRoutes.post("/sales", requireJwt, async (c) => {
  const parsed = salesCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, parsed.data.branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 수정할 수 없습니다", 403);
  const { data, error } = await db.from("sales_entries").insert({ ...parsed.data, created_by: profile.id }).select().maybeSingle();
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data, "등록되었습니다");
});

dailyReportsRoutes.delete("/sales/:id", requireJwt, async (c) => {
  const id = c.req.param("id");
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data: row } = await db.from("sales_entries").select("branch_id").eq("id", id).maybeSingle();
  if (!row) return fail(c, "NOT_FOUND", "대상을 찾을 수 없습니다", 404);
  if (!canAccessBranch(profile, (row as { branch_id: string }).branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 수정할 수 없습니다", 403);
  const { error } = await db.from("sales_entries").delete().eq("id", id);
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { id }, "삭제되었습니다");
});

// ── 당일 매출 요약 (자동 합계 + 결제수단) ────────────────────
dailyReportsRoutes.get("/sales-summary", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id");
  const date = c.req.query("date") ?? kstDateStr();
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const [{ data: sRaw }, { data: pRaw }] = await Promise.all([
    db.from("sales_entries").select("category,payment_method,amount").eq("branch_id", branchId).eq("sale_date", date),
    db.from("pt_passes").select("payment_method,amount").eq("branch_id", branchId).eq("reg_date", date),
  ]);
  const sales = (sRaw as { category: string; payment_method: string; amount: number }[] | null) ?? [];
  const pts = (pRaw as { payment_method: string | null; amount: number }[] | null) ?? [];
  const sumCat = (cat: string): number => sales.filter((s) => s.category === cat).reduce((a, s) => a + s.amount, 0);
  const pay = (m: string): number =>
    sales.filter((s) => s.payment_method === m).reduce((a, s) => a + s.amount, 0) +
    pts.filter((p) => p.payment_method === m).reduce((a, p) => a + p.amount, 0);
  const ptAmount = pts.reduce((a, p) => a + p.amount, 0);
  return ok(c, {
    revenue: { membership: sumCat("수강권"), goods: sumCat("물품"), dan: sumCat("단증"), pt: ptAmount },
    payment: { cash: pay("현금"), card: pay("카드"), transfer: pay("계좌이체") },
  });
});

// ── 복싱 PT 회차 관리 ────────────────────────────────────────
interface PtRow {
  id: string; branch_id: string; member_name: string; total_sessions: number;
  used_sessions: number; no_shows: number; payment_method: string | null; amount: number;
  is_new: boolean; reg_date: string; status: string;
}
dailyReportsRoutes.get("/pt", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id");
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data } = await db.from("pt_passes").select("*").eq("branch_id", branchId).order("created_at", { ascending: false });
  return ok(c, { passes: (data as PtRow[] | null) ?? [] });
});

const ptCreateSchema = z.object({
  branch_id: z.string().uuid(),
  member_name: z.string().min(1, "이름을 입력하세요"),
  total_sessions: z.number().int().min(1),
  payment_method: z.enum(["현금", "카드", "계좌이체"]).nullish(),
  amount: z.number().int().min(0).default(0),
  is_new: z.boolean().default(true),
  reg_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});
dailyReportsRoutes.post("/pt", requireJwt, async (c) => {
  const parsed = ptCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, parsed.data.branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 수정할 수 없습니다", 403);
  const { data, error } = await db.from("pt_passes").insert({
    branch_id: parsed.data.branch_id,
    member_name: parsed.data.member_name,
    total_sessions: parsed.data.total_sessions,
    payment_method: parsed.data.payment_method ?? null,
    amount: parsed.data.amount,
    is_new: parsed.data.is_new,
    reg_date: parsed.data.reg_date ?? kstDateStr(),
    created_by: profile.id,
  }).select().maybeSingle();
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data, "등록되었습니다");
});

const ptUpdateSchema = z.object({
  used_sessions: z.number().int().min(0).optional(),
  no_shows: z.number().int().min(0).optional(),
  status: z.enum(["active", "완료"]).optional(),
});
dailyReportsRoutes.put("/pt/:id", requireJwt, async (c) => {
  const id = c.req.param("id");
  const parsed = ptUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "Invalid body", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data: row } = await db.from("pt_passes").select("branch_id").eq("id", id).maybeSingle();
  if (!row) return fail(c, "NOT_FOUND", "대상을 찾을 수 없습니다", 404);
  if (!canAccessBranch(profile, (row as { branch_id: string }).branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 수정할 수 없습니다", 403);
  const { error } = await db.from("pt_passes").update({ ...parsed.data, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { id }, "저장되었습니다");
});

dailyReportsRoutes.delete("/pt/:id", requireJwt, async (c) => {
  const id = c.req.param("id");
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data: row } = await db.from("pt_passes").select("branch_id").eq("id", id).maybeSingle();
  if (!row) return fail(c, "NOT_FOUND", "대상을 찾을 수 없습니다", 404);
  if (!canAccessBranch(profile, (row as { branch_id: string }).branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 수정할 수 없습니다", 403);
  const { error } = await db.from("pt_passes").delete().eq("id", id);
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { id }, "삭제되었습니다");
});

// ── 환불 자동 계산기 (저장/목록/상태) ────────────────────────
const refundCreateSchema = z.object({
  branch_id: z.string().uuid(),
  member_name: z.string().min(1, "이름을 입력하세요"),
  phone: z.string().nullish(),
  product_name: z.string().nullish(),
  contract_type: z.string().nullish(),
  refund_reason_type: z.string().nullish(),
  payment_method: z.string().nullish(),
  payment_date: z.string().nullish(),
  start_date: z.string().nullish(),
  end_date: z.string().nullish(),
  refund_requested_date: z.string().nullish(),
  payment_amount: z.number().int().min(0).default(0),
  tuition_amount: z.number().int().min(0).default(0),
  total_days: z.number().int().default(0),
  elapsed_days: z.number().int().default(0),
  remaining_days: z.number().int().default(0),
  total_sessions: z.number().int().default(0),
  used_sessions: z.number().int().default(0),
  remaining_sessions: z.number().int().default(0),
  penalty_rate: z.number().default(0),
  penalty_amount: z.number().int().default(0),
  used_amount: z.number().int().default(0),
  equipment_fee: z.number().int().default(0),
  equipment_deducted: z.number().int().default(0),
  additional_deduction_amount: z.number().int().default(0),
  calculated_refund_amount: z.number().int().default(0),
  final_refund_amount: z.number().int().default(0),
  rounding_type: z.string().nullish(),
  refund_method: z.string().nullish(),
  refund_status: z.string().default("waiting_member_agreement"),
  risk_level: z.string().nullish(),
  risk_messages: z.array(z.unknown()).default([]),
  member_message: z.string().nullish(),
  internal_memo: z.string().nullish(),
  card_approval_number: z.string().nullish(),
  input_snapshot: z.unknown().optional(),
});
dailyReportsRoutes.post("/refunds", requireJwt, async (c) => {
  const parsed = refundCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, parsed.data.branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 수정할 수 없습니다", 403);
  const { data, error } = await db
    .from("refund_requests")
    .insert({ ...parsed.data, created_by: profile.id, processed_by: profile.id })
    .select()
    .maybeSingle();
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data, "환불 요청이 저장되었습니다");
});

dailyReportsRoutes.get("/refunds", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id");
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data } = await db
    .from("refund_requests")
    .select("*")
    .eq("branch_id", branchId)
    .order("created_at", { ascending: false })
    .limit(100);
  return ok(c, { refunds: data ?? [] });
});

const refundUpdateSchema = z.object({
  refund_status: z.string().optional(),
  refund_method: z.string().nullish(),
  card_approval_number: z.string().nullish(),
  member_agreed: z.boolean().optional(),
});
dailyReportsRoutes.put("/refunds/:id", requireJwt, async (c) => {
  const id = c.req.param("id");
  const parsed = refundUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "Invalid body", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data: row } = await db.from("refund_requests").select("branch_id").eq("id", id).maybeSingle();
  if (!row) return fail(c, "NOT_FOUND", "대상을 찾을 수 없습니다", 404);
  if (!canAccessBranch(profile, (row as { branch_id: string }).branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 수정할 수 없습니다", 403);
  const patch: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };
  if (parsed.data.member_agreed === true) patch.agreed_at = new Date().toISOString();
  const { error } = await db.from("refund_requests").update(patch).eq("id", id);
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { id }, "저장되었습니다");
});

// ── 문의/리드 CRM (lead_inquiries) ──────────────────────────
const leadCreateSchema = z.object({
  branch_id: z.string().uuid(),
  lead_name: z.string().min(1),
  phone: z.string().nullish(),
  source: z.string().nullish(),
  interest_product: z.string().nullish(),
  status: z.string().default("inquiry"),
  first_contact_at: z.string().nullish(),
  trial_at: z.string().nullish(),
  next_action_at: z.string().nullish(),
  memo: z.string().nullish(),
});
dailyReportsRoutes.post("/leads", requireJwt, async (c) => {
  const parsed = leadCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, parsed.data.branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 수정할 수 없습니다", 403);
  const { data, error } = await db.from("lead_inquiries").insert({ ...parsed.data, created_by: profile.id }).select().maybeSingle();
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data, "문의가 등록되었습니다");
});

dailyReportsRoutes.get("/leads", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id");
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data } = await db.from("lead_inquiries").select("*").eq("branch_id", branchId).order("created_at", { ascending: false }).limit(200);
  return ok(c, { leads: data ?? [] });
});

const leadUpdateSchema = z.object({
  lead_name: z.string().optional(),
  phone: z.string().nullish(),
  source: z.string().nullish(),
  interest_product: z.string().nullish(),
  status: z.string().optional(),
  first_contact_at: z.string().nullish(),
  trial_at: z.string().nullish(),
  next_action_at: z.string().nullish(),
  memo: z.string().nullish(),
  result_reason: z.string().nullish(),
});
dailyReportsRoutes.put("/leads/:id", requireJwt, async (c) => {
  const id = c.req.param("id");
  const parsed = leadUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "Invalid body", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data: row } = await db.from("lead_inquiries").select("branch_id,first_contact_at").eq("id", id).maybeSingle();
  if (!row) return fail(c, "NOT_FOUND", "대상을 찾을 수 없습니다", 404);
  const r = row as { branch_id: string; first_contact_at: string | null };
  if (!canAccessBranch(profile, r.branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 수정할 수 없습니다", 403);
  const patch: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };
  // 편의: inquiry → 그 이후 상태로 전환 시 첫 응대 시각 자동 기록
  if (parsed.data.status && parsed.data.status !== "inquiry" && !r.first_contact_at && parsed.data.first_contact_at == null) {
    patch.first_contact_at = new Date().toISOString();
  }
  const { error } = await db.from("lead_inquiries").update(patch).eq("id", id);
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { id }, "저장되었습니다");
});

// ── 회원 스냅샷 (브로제이 CSV 일괄 임포트) ──────────────────
function phoneDigitsW(s: string | null | undefined): string { return (s ?? "").replace(/[^0-9]/g, ""); }
const memberRowSchema = z.object({
  member_name: z.string().min(1),
  phone: z.string().nullish(),
  product_name: z.string().nullish(),
  membership_type: z.string().nullish(),
  start_date: z.string().nullish(),
  end_date: z.string().nullish(),
  total_sessions: z.number().int().nullish(),
  used_sessions: z.number().int().nullish(),
  remaining_sessions: z.number().int().nullish(),
  latest_visit_date: z.string().nullish(),
  payment_amount: z.number().int().nullish(),
  payment_method: z.string().nullish(),
  assigned_coach: z.string().nullish(),
  status: z.string().nullish(),
  raw_payload: z.record(z.unknown()).optional(),
});
const memberImportSchema = z.object({
  branch_id: z.string().uuid(),
  file_name: z.string().nullish(),
  import_type: z.string().default("broj_members"),
  mapping: z.record(z.unknown()).optional(),
  rows: z.array(memberRowSchema).min(1).max(5000),
});
dailyReportsRoutes.post("/members/import", requireJwt, async (c) => {
  const parsed = memberImportSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const { branch_id, rows } = parsed.data;
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 가져올 수 없습니다", 403);

  // 1) import_job 기록
  const { data: job } = await db.from("import_jobs").insert({
    branch_id, import_type: parsed.data.import_type, file_name: parsed.data.file_name ?? null,
    status: "parsed", total_rows: rows.length, mapping: parsed.data.mapping ?? {}, created_by: profile.id,
  }).select("id").maybeSingle();
  const jobId = (job as { id: string } | null)?.id ?? null;

  // 2) 기존 스냅샷 전화 정규화 맵
  const { data: existRaw } = await db.from("member_snapshots").select("id,normalized_phone").eq("branch_id", branch_id);
  const byPhone = new Map<string, string>();
  for (const e of (existRaw as { id: string; normalized_phone: string | null }[] | null) ?? []) {
    if (e.normalized_phone) byPhone.set(e.normalized_phone, e.id);
  }

  // 3) 파일 내 전화 중복 제거(마지막 우선)
  const seen = new Map<string, number>();
  const dedup: typeof rows = [];
  for (const r of rows) {
    const norm = phoneDigitsW(r.phone);
    if (norm) {
      const idx = seen.get(norm);
      if (idx !== undefined) { dedup[idx] = r; continue; }
      seen.set(norm, dedup.length);
    }
    dedup.push(r);
  }

  // 4) insert / update 분리
  const toInsert: Record<string, unknown>[] = [];
  const toUpdate: Record<string, unknown>[] = [];
  for (const r of dedup) {
    const base: Record<string, unknown> = {
      branch_id, member_name: r.member_name, phone: r.phone ?? null,
      product_name: r.product_name ?? null, membership_type: r.membership_type ?? null,
      start_date: r.start_date ?? null, end_date: r.end_date ?? null,
      total_sessions: r.total_sessions ?? null, used_sessions: r.used_sessions ?? null, remaining_sessions: r.remaining_sessions ?? null,
      latest_visit_date: r.latest_visit_date ?? null, payment_amount: r.payment_amount ?? null,
      payment_method: r.payment_method ?? null, assigned_coach: r.assigned_coach ?? null,
      status: r.status ?? null, source: "broj_csv", import_job_id: jobId, raw_payload: r.raw_payload ?? {},
      updated_at: new Date().toISOString(),
    };
    const norm = phoneDigitsW(r.phone);
    const existId = norm ? byPhone.get(norm) : undefined;
    if (existId) toUpdate.push({ id: existId, ...base });
    else toInsert.push(base);
  }

  // 5) 반영 (normalized_phone 은 생성열이라 쓰지 않음)
  let imported = 0; let failed = 0;
  if (toInsert.length) {
    const { error } = await db.from("member_snapshots").insert(toInsert);
    if (error) failed += toInsert.length; else imported += toInsert.length;
  }
  if (toUpdate.length) {
    const { error } = await db.from("member_snapshots").upsert(toUpdate, { onConflict: "id" });
    if (error) failed += toUpdate.length; else imported += toUpdate.length;
  }

  if (jobId) {
    await db.from("import_jobs").update({
      status: failed > 0 && imported === 0 ? "failed" : "imported",
      imported_rows: imported, failed_rows: failed, completed_at: new Date().toISOString(),
    }).eq("id", jobId);
  }
  return ok(c, { job_id: jobId, total: rows.length, deduped: dedup.length, imported, updated: toUpdate.length, inserted: toInsert.length, failed }, `${imported}명 반영 완료`);
});

dailyReportsRoutes.get("/members", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id");
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data } = await db
    .from("member_snapshots")
    .select("id,member_name,phone,product_name,membership_type,end_date,latest_visit_date,remaining_sessions,status,assigned_coach,updated_at")
    .eq("branch_id", branchId)
    .order("end_date", { ascending: true, nullsFirst: false })
    .limit(1000);
  return ok(c, { members: data ?? [] });
});

// ── 시설/장비 이슈 티켓 (issue_tickets) ─────────────────────
const issueCreateSchema = z.object({
  branch_id: z.string().uuid(),
  title: z.string().min(1),
  category: z.string().default("facility"),
  severity: z.string().default("normal"),
  status: z.string().default("open"),
  location: z.string().nullish(),
  description: z.string().nullish(),
  photo_url: z.string().nullish(),
  due_at: z.string().nullish(),
  cost_amount: z.number().int().nullish(),
  vendor_name: z.string().nullish(),
});
dailyReportsRoutes.post("/issues", requireJwt, async (c) => {
  const parsed = issueCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, parsed.data.branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 등록할 수 없습니다", 403);
  const { data, error } = await db.from("issue_tickets").insert({ ...parsed.data, created_by: profile.id }).select().maybeSingle();
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data, "이슈가 등록되었습니다");
});
dailyReportsRoutes.get("/issues", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id");
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data } = await db.from("issue_tickets").select("*").eq("branch_id", branchId).order("created_at", { ascending: false }).limit(200);
  return ok(c, { issues: data ?? [] });
});
const issueUpdateSchema = z.object({
  title: z.string().optional(),
  category: z.string().optional(),
  severity: z.string().optional(),
  status: z.string().optional(),
  location: z.string().nullish(),
  description: z.string().nullish(),
  photo_url: z.string().nullish(),
  due_at: z.string().nullish(),
  cost_amount: z.number().int().nullish(),
  vendor_name: z.string().nullish(),
});
dailyReportsRoutes.put("/issues/:id", requireJwt, async (c) => {
  const id = c.req.param("id");
  const parsed = issueUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "Invalid body", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data: row } = await db.from("issue_tickets").select("branch_id").eq("id", id).maybeSingle();
  if (!row) return fail(c, "NOT_FOUND", "대상을 찾을 수 없습니다", 404);
  if (!canAccessBranch(profile, (row as { branch_id: string }).branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 수정할 수 없습니다", 403);
  const patch: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };
  if (parsed.data.status === "done") patch.completed_at = new Date().toISOString();
  const { error } = await db.from("issue_tickets").update(patch).eq("id", id);
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { id }, "저장되었습니다");
});

// ── 메시지 발송 로그 (ops_message_logs) ─────────────────────
const msgLogSchema = z.object({
  branch_id: z.string().uuid(),
  recipient_name: z.string().nullish(),
  phone: z.string().nullish(),
  template_type: z.string().min(1),
  related_type: z.string().nullish(),
  related_id: z.string().uuid().nullish(),
  content: z.string().min(1),
  status: z.string().default("copied"),
});
dailyReportsRoutes.post("/messages/log", requireJwt, async (c) => {
  const parsed = msgLogSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, parsed.data.branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 기록할 수 없습니다", 403);
  const { error } = await db.from("ops_message_logs").insert({ ...parsed.data, copied_at: new Date().toISOString(), created_by: profile.id });
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { ok: true }, "발송 기록됨");
});
dailyReportsRoutes.get("/messages", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id");
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data } = await db
    .from("ops_message_logs")
    .select("id,recipient_name,template_type,content,status,created_at")
    .eq("branch_id", branchId)
    .order("created_at", { ascending: false })
    .limit(100);
  return ok(c, { messages: data ?? [] });
});

// ── 일일 다이제스트 (복사용 요약) ───────────────────────────
dailyReportsRoutes.get("/digest", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id");
  const date = c.req.query("date") ?? kstDateStr();
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);

  let score = (await db.from("branch_daily_scores").select("total_score,grade").eq("branch_id", branchId).eq("score_date", date).maybeSingle()).data as { total_score: number; grade: string | null } | null;
  if (!score && WRITE_ROLES.has(profile.role)) {
    try { await runGenerate(db, branchId, date, profile.id); } catch { /* 무시 */ }
    score = (await db.from("branch_daily_scores").select("total_score,grade").eq("branch_id", branchId).eq("score_date", date).maybeSingle()).data as { total_score: number; grade: string | null } | null;
  }
  const [brow, rep, tasksR, alertsR, refundR, issueR, summary] = await Promise.all([
    db.from("branches").select("name").eq("id", branchId).maybeSingle(),
    db.from("daily_reports").select("new_signups,re_signups,inquiry_count").eq("branch_id", branchId).eq("report_date", date).maybeSingle(),
    db.from("operation_tasks").select("priority,status").eq("branch_id", branchId).eq("task_date", date),
    db.from("operation_alerts").select("severity,status").eq("branch_id", branchId).eq("alert_date", date),
    db.from("refund_requests").select("id").eq("branch_id", branchId).not("refund_status", "in", "(completed,canceled,rejected)"),
    db.from("issue_tickets").select("id").eq("branch_id", branchId).in("status", ["open", "in_progress", "waiting_vendor"]),
    computeSummary(db, branchId, date),
  ]);
  const branchName = (brow.data as { name: string } | null)?.name ?? "지점";
  const report = rep.data as { new_signups: number; re_signups: number; inquiry_count: number } | null;
  const tasks = (tasksR.data as { priority: string; status: string }[] | null) ?? [];
  const alerts = (alertsR.data as { severity: string; status: string }[] | null) ?? [];
  const active = tasks.filter((t) => t.status !== "done" && t.status !== "canceled" && t.status !== "skipped");
  const done = tasks.filter((t) => t.status === "done").length;
  const mustDo = active.filter((t) => t.priority === "urgent" || t.priority === "high").length;
  const danger = alerts.filter((a) => (a.severity === "danger" || a.severity === "critical") && a.status !== "resolved" && a.status !== "dismissed").length;
  const refundPending = ((refundR.data as unknown[] | null) ?? []).length;
  const issueOpen = ((issueR.data as unknown[] | null) ?? []).length;
  const ach = summary.achievement == null ? null : Math.round(summary.achievement * 100);
  const gradeKo = score?.grade === "danger" ? "위험" : score?.grade === "watch" ? "주의" : score?.grade === "safe" ? "안전" : "-";
  const wonFmt = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

  const lines = [
    `[${branchName}] ${date} 일일 요약`,
    `운영점수 ${score?.total_score ?? "-"}점 (${gradeKo})`,
    `순매출 ${wonFmt(summary.day_net)}${ach != null ? ` · 월목표 ${ach}%` : ""}`,
    `신규 ${report?.new_signups ?? 0} · 재등록 ${report?.re_signups ?? 0} · 문의 ${report?.inquiry_count ?? 0}`,
    `업무완료 ${done}/${tasks.length}${mustDo > 0 ? ` · 필수 미완 ${mustDo}` : ""}`,
  ];
  const risks: string[] = [];
  if (danger > 0) risks.push(`위험알림 ${danger}`);
  if (refundPending > 0) risks.push(`환불대기 ${refundPending}`);
  if (issueOpen > 0) risks.push(`시설이슈 ${issueOpen}`);
  lines.push(risks.length ? `[주의] ${risks.join(" · ")}` : `[정상] 예외 없음`);

  return ok(c, {
    date, branch_name: branchName,
    total_score: score?.total_score ?? null, grade: score?.grade ?? null,
    day_net: summary.day_net, month_achievement: ach,
    new_signups: report?.new_signups ?? 0, re_signups: report?.re_signups ?? 0, inquiry_count: report?.inquiry_count ?? 0,
    tasks_done: done, tasks_total: tasks.length, must_do_open: mustDo,
    danger_alerts: danger, refund_pending: refundPending, issue_open: issueOpen,
    text: lines.join("\n"),
  });
});

// ── 월간 KPI (지점장 실력점수: 일일점수 평균 × 작성률 가중 + 익명 순위) ──
interface KpiScoreRow { total_score: number; report_score: number; sales_score: number; task_score: number; followup_score: number; lead_score: number; checklist_score: number; refund_score: number; facility_score: number }
function kpiMonthRange(month: string) {
  const y = Number(month.slice(0, 4)); const m = Number(month.slice(5, 7));
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, "0")}`, lastDay };
}
function kpiGrade(k: number): string { return k >= 90 ? "S" : k >= 80 ? "A" : k >= 70 ? "B" : k >= 60 ? "C" : "D"; }
function prevMonthStr(month: string): string {
  const y = Number(month.slice(0, 4)); const m = Number(month.slice(5, 7));
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
async function computeBranchKpi(db: SupabaseClient, branchId: string, month: string) {
  const { start, end, lastDay } = kpiMonthRange(month);
  const { data: sraw } = await db.from("branch_daily_scores")
    .select("total_score,report_score,sales_score,task_score,followup_score,lead_score,checklist_score,refund_score,facility_score")
    .eq("branch_id", branchId).gte("score_date", start).lte("score_date", end);
  const scores = (sraw as KpiScoreRow[] | null) ?? [];
  const daysScored = scores.length;
  const today = kstDateStr();
  const elapsed = today.slice(0, 7) === month ? Number(today.slice(8, 10)) : lastDay;
  const { count } = await db.from("daily_reports").select("id", { count: "exact", head: true })
    .eq("branch_id", branchId).gte("report_date", start).lte("report_date", end);
  const reportsCount = count ?? 0;
  const reportRate = elapsed > 0 ? Math.min(1, reportsCount / elapsed) : 0;
  const avg = daysScored ? scores.reduce((s, r) => s + r.total_score, 0) / daysScored : 0;
  const kpi = daysScored ? Math.round(avg * (0.7 + 0.3 * reportRate)) : 0;
  const avgOf = (sel: (r: KpiScoreRow) => number) => daysScored ? Math.round((scores.reduce((s, r) => s + sel(r), 0) / daysScored) * 10) / 10 : 0;
  return {
    kpi, avg_score: Math.round(avg * 10) / 10, report_rate: Math.round(reportRate * 100), days_scored: daysScored,
    grade: daysScored ? kpiGrade(kpi) : "-",
    components: {
      report: avgOf((r) => r.report_score), sales: avgOf((r) => r.sales_score), task: avgOf((r) => r.task_score),
      followup: avgOf((r) => r.followup_score), lead: avgOf((r) => r.lead_score), checklist: avgOf((r) => r.checklist_score),
      refund: avgOf((r) => r.refund_score), facility: avgOf((r) => r.facility_score),
    },
  };
}
dailyReportsRoutes.get("/kpi", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id");
  const month = c.req.query("month") ?? kstDateStr().slice(0, 7);
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);

  const me = await computeBranchKpi(db, branchId, month);
  const prev = await computeBranchKpi(db, branchId, prevMonthStr(month));
  const brow = await db.from("branches").select("name").eq("id", branchId).maybeSingle();
  const branchName = (brow.data as { name: string } | null)?.name ?? "지점";

  // 익명 순위 — 전 지점 KPI 계산 후 순위만 산출(타 지점 점수/이름 미반환)
  const { data: braw } = await db.from("branches").select("id");
  const allBranches = (braw as { id: string }[] | null) ?? [];
  const allKpis = await Promise.all(allBranches.map(async (b) => ({ id: b.id, kpi: (await computeBranchKpi(db, b.id, month)).kpi })));
  const ranked = allKpis.filter((x) => x.kpi > 0).sort((a, b) => b.kpi - a.kpi);
  const rankIdx = ranked.findIndex((x) => x.id === branchId);

  return ok(c, {
    month, branch_name: branchName, ...me,
    prev_kpi: prev.days_scored ? prev.kpi : null,
    delta: prev.days_scored && me.days_scored ? me.kpi - prev.kpi : null,
    rank: rankIdx >= 0 ? rankIdx + 1 : null,
    total_branches: ranked.length,
  });
});
dailyReportsRoutes.get("/kpi/ranking", requireJwt, async (c) => {
  const month = c.req.query("month") ?? kstDateStr().slice(0, 7);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !HQ_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "본사 전용입니다", 403);
  const { data: braw } = await db.from("branches").select("id,name").order("name");
  const branches = (braw as BranchRow[] | null) ?? [];
  const rows = await Promise.all(branches.map(async (b) => {
    const k = await computeBranchKpi(db, b.id, month);
    return { branch_id: b.id, branch_name: b.name, kpi: k.kpi, grade: k.grade, avg_score: k.avg_score, report_rate: k.report_rate, days_scored: k.days_scored };
  }));
  rows.sort((a, b) => b.kpi - a.kpi);
  return ok(c, { month, ranking: rows });
});

// ── 오토운영 엔진: 태스크/알림/점수 생성·조회 ────────────────
interface MonthRevRow { revenue_pt: number; revenue_membership: number; revenue_goods: number; revenue_dan: number; refund_amount: number }

async function runGenerate(db: SupabaseClient, branchId: string, date: string, profileId: string) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const ym = date.slice(0, 7);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthStart = `${ym}-01`;
  const monthEnd = `${ym}-${String(lastDay).padStart(2, "0")}`;
  const monthProgressRatio = lastDay > 0 ? Number(date.slice(8, 10)) / lastDay : 0;
  const kstHour = new Date(Date.now() + 9 * 3600 * 1000).getUTCHours();
  const afterCloseCutoff = kstHour >= 22 || kstHour < 5;

  const [rep, cl, fu, pt, rf, ld, sn, iss, tgt, monthRows] = await Promise.all([
    db.from("daily_reports").select("*").eq("branch_id", branchId).eq("report_date", date).maybeSingle(),
    db.from("daily_checklists").select("items").eq("branch_id", branchId).eq("report_date", date).maybeSingle(),
    db.from("member_followups").select("id,member_name,status,expire_date").eq("branch_id", branchId).eq("status", "진행중"),
    db.from("pt_passes").select("id,member_name,total_sessions,used_sessions,no_shows,status").eq("branch_id", branchId).eq("status", "active"),
    db.from("refund_requests").select("id,member_name,refund_status,risk_level,refund_requested_date").eq("branch_id", branchId).not("refund_status", "in", "(completed,canceled,rejected)"),
    db.from("lead_inquiries").select("id,lead_name,status,first_contact_at,trial_at,next_action_at").eq("branch_id", branchId).not("status", "in", "(registered,failed)"),
    db.from("member_snapshots").select("id,member_name,phone,end_date,latest_visit_date,start_date,status").eq("branch_id", branchId).limit(1000),
    db.from("issue_tickets").select("id,title,severity,status,due_at,created_at").eq("branch_id", branchId).in("status", ["open", "in_progress", "waiting_vendor"]),
    db.from("monthly_targets").select("target_amount").eq("branch_id", branchId).eq("year", year).eq("month", month).maybeSingle(),
    db.from("daily_reports").select("revenue_pt,revenue_membership,revenue_goods,revenue_dan,refund_amount").eq("branch_id", branchId).gte("report_date", monthStart).lte("report_date", monthEnd),
  ]);

  const rr = rep.data as (ReportIn & Record<string, unknown>) | null;
  const items = ((cl.data as { items?: { no: number; done?: boolean; actual?: number }[] } | null)?.items) ?? [];
  const monthNet = ((monthRows.data as MonthRevRow[] | null) ?? []).reduce(
    (s, r) => s + (r.revenue_pt + r.revenue_membership + r.revenue_goods + r.revenue_dan - (r.refund_amount ?? 0)), 0);
  const target = Number((tgt.data as { target_amount: number } | null)?.target_amount ?? 0);

  const input: OpsInput = {
    branchId, date, nowIso: new Date().toISOString(), afterCloseCutoff,
    report: rr
      ? { revenue_pt: rr.revenue_pt, revenue_membership: rr.revenue_membership, revenue_goods: rr.revenue_goods,
          revenue_dan: rr.revenue_dan, refund_amount: rr.refund_amount ?? 0, new_signups: rr.new_signups,
          re_signups: rr.re_signups, inquiry_count: rr.inquiry_count, morning_attendance: rr.morning_attendance,
          lunch_attendance: rr.lunch_attendance, evening_attendance: rr.evening_attendance }
      : null,
    checklist: items.map((it) => ({ no: it.no, done: !!it.done, actual: it.actual ?? 0 })),
    followups: (fu.data as FollowupIn[] | null) ?? [],
    ptPasses: (pt.data as PtIn[] | null) ?? [],
    refunds: (rf.data as RefundIn[] | null) ?? [],
    leads: (ld.data as LeadIn[] | null) ?? [],
    snapshots: (sn.data as SnapshotIn[] | null) ?? [],
    issues: (iss.data as IssueIn[] | null) ?? [],
    monthlyTarget: target, monthNetCumulative: monthNet, monthProgressRatio,
  };

  const taskDrafts = generateTasks(input);
  const alertDrafts = generateAlerts(input);
  const score = computeScore(input, taskDrafts);

  if (taskDrafts.length)
    await db.from("operation_tasks").upsert(
      taskDrafts.map((d) => ({
        branch_id: branchId, task_date: date, category: d.category, priority: d.priority, title: d.title,
        description: d.description ?? null, action_label: d.action_label ?? null, source_type: d.source_type ?? null,
        source_id: d.source_id ?? null, generated_key: d.generated_key, member_name: d.member_name ?? null,
        member_phone: d.member_phone ?? null, due_at: d.due_at ?? null, metadata: d.metadata ?? {}, created_by: profileId,
      })),
      { onConflict: "branch_id,task_date,generated_key", ignoreDuplicates: true });

  // 점검/리포트 대표 태스크 자동완료: 드래프트에 없으면(=실제 작업 완료) 남아있던 태스크를 done 처리
  const reconcileKeys = ["report_missing", "open_check", "close_check"];
  const presentKeys = new Set(taskDrafts.map((d) => d.generated_key));
  const resolvedKeys = reconcileKeys.filter((k) => !presentKeys.has(k));
  if (resolvedKeys.length)
    await db.from("operation_tasks")
      .update({ status: "done", completed_at: new Date().toISOString(), completed_by: profileId, updated_at: new Date().toISOString() })
      .eq("branch_id", branchId).eq("task_date", date).in("generated_key", resolvedKeys).in("status", ["pending", "in_progress", "postponed"]);

  if (alertDrafts.length)
    await db.from("operation_alerts").upsert(
      alertDrafts.map((d) => ({
        branch_id: branchId, alert_date: date, severity: d.severity, category: d.category, title: d.title,
        message: d.message, source_type: d.source_type ?? null, source_id: d.source_id ?? null,
        generated_key: d.generated_key, score_impact: d.score_impact ?? 0,
      })),
      { onConflict: "branch_id,alert_date,generated_key", ignoreDuplicates: true });
  await db.from("branch_daily_scores").upsert(
    { branch_id: branchId, score_date: date, total_score: score.total, report_score: score.report,
      sales_score: score.sales, task_score: score.task, followup_score: score.followup, lead_score: score.lead,
      checklist_score: score.checklist, refund_score: score.refund, facility_score: score.facility,
      grade: score.grade, summary: score.summary, details: score.details, updated_at: new Date().toISOString() },
    { onConflict: "branch_id,score_date" });

  return { tasks: taskDrafts.length, alerts: alertDrafts.length, score };
}

const opsGenSchema = z.object({ branch_id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() });
dailyReportsRoutes.post("/ops/generate", requireJwt, async (c) => {
  const parsed = opsGenSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, parsed.data.branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 처리할 수 없습니다", 403);
  const date = parsed.data.date ?? kstDateStr();
  const r = await runGenerate(db, parsed.data.branch_id, date, profile.id);
  return ok(c, r, "오늘 업무·알림을 생성했습니다");
});

dailyReportsRoutes.get("/ops/today", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id");
  const date = c.req.query("date") ?? kstDateStr();
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);

  const { data: existing } = await db.from("branch_daily_scores").select("score_date").eq("branch_id", branchId).eq("score_date", date).maybeSingle();
  if (!existing && WRITE_ROLES.has(profile.role)) await runGenerate(db, branchId, date, profile.id);

  const [tasks, alerts, score] = await Promise.all([
    db.from("operation_tasks").select("*").eq("branch_id", branchId).eq("task_date", date).order("priority").order("created_at"),
    db.from("operation_alerts").select("*").eq("branch_id", branchId).eq("alert_date", date).neq("status", "dismissed").order("severity"),
    db.from("branch_daily_scores").select("*").eq("branch_id", branchId).eq("score_date", date).maybeSingle(),
  ]);
  return ok(c, { date, tasks: tasks.data ?? [], alerts: alerts.data ?? [], score: score.data ?? null });
});

dailyReportsRoutes.get("/tasks", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id");
  const date = c.req.query("date") ?? kstDateStr();
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data } = await db.from("operation_tasks").select("*").eq("branch_id", branchId).eq("task_date", date).order("created_at");
  return ok(c, { tasks: data ?? [] });
});

// ── 게임 프로필(미션 영속): XP/레벨/스트릭 ───────────────────
const GP_LEVELS: { min: number; level: number }[] = [
  { min: 0, level: 1 }, { min: 200, level: 5 }, { min: 600, level: 10 },
  { min: 1500, level: 20 }, { min: 3000, level: 30 }, { min: 6000, level: 50 },
];
function gpLevel(xp: number): number { let lv = 1; for (const l of GP_LEVELS) if (xp >= l.min) lv = l.level; return lv; }
function taskXp(genKey: string | null, category: string): number {
  const k = genKey ?? "";
  if (k === "report_missing") return 10;
  if (k === "open_check" || k === "close_check") return 5;
  if (k.startsWith("action_1")) return 8;
  if (k.startsWith("action_")) return 5;
  switch (category) {
    case "followup": return 8; case "member_care": return 5; case "refund": return 15;
    case "facility": return 20; case "pt": return 8; case "lead": return 8; case "sales": return 15;
    case "open": case "close": return 5; case "report": return 10; default: return 5;
  }
}
interface GameProfileRow { id: string; total_xp: number; current_streak: number; best_streak: number; last_success_date: string | null; hp: number }
async function awardGameXp(db: SupabaseClient, branchId: string, profileId: string, domain: string, opts: { taskId?: string; title: string; xp: number }) {
  const today = kstDateStr();
  const { data } = await db.from("game_profiles").select("id,total_xp,current_streak,best_streak,last_success_date,hp")
    .eq("branch_id", branchId).eq("domain", domain).eq("owner_type", "branch").is("owner_id", null).maybeSingle();
  const prev = data as GameProfileRow | null;
  const newXp = (prev?.total_xp ?? 0) + opts.xp;
  let streak = prev?.current_streak ?? 0;
  if (!prev || prev.last_success_date !== today) {
    streak = prev && prev.last_success_date === addDays(today, -1) ? (prev.current_streak ?? 0) + 1 : 1;
  }
  const best = Math.max(prev?.best_streak ?? 0, streak);
  const payload = {
    branch_id: branchId, domain, owner_type: "branch", owner_id: null,
    total_xp: newXp, level: gpLevel(newXp), current_streak: streak, best_streak: best,
    last_success_date: today, updated_at: new Date().toISOString(),
  };
  if (prev) await db.from("game_profiles").update(payload).eq("id", prev.id);
  else await db.from("game_profiles").insert(payload);
  await db.from("reward_events").insert({ branch_id: branchId, domain, owner_type: "branch", owner_id: null, user_id: profileId, event_date: today, reward_type: "xp", title: "미션 완료", message: opts.title, xp_bonus: opts.xp, related_task_id: opts.taskId ?? null });
  await db.from("activity_logs").insert({ branch_id: branchId, domain, user_id: profileId, activity_date: today, activity_type: "mission_done", related_type: "operation_task", related_id: opts.taskId ?? null, memo: opts.title });
}
dailyReportsRoutes.get("/game-profile", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id");
  const domain = c.req.query("domain") ?? "branch_ops";
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data } = await db.from("game_profiles").select("total_xp,level,current_streak,best_streak,streak_freezes,last_success_date,hp,badges")
    .eq("branch_id", branchId).eq("domain", domain).eq("owner_type", "branch").is("owner_id", null).maybeSingle();
  return ok(c, data ?? { total_xp: 0, level: 1, current_streak: 0, best_streak: 0, streak_freezes: 1, last_success_date: null, hp: 100, badges: [] });
});

// 복구권 사용 — 끊긴 스트릭을 어제로 브리지(오늘 미션 완료 시 연속 유지)
const gameProfilePutSchema = z.object({ branch_id: z.string().uuid(), domain: z.string().default("branch_ops"), use_freeze: z.boolean().optional() });
dailyReportsRoutes.put("/game-profile", requireJwt, async (c) => {
  const parsed = gameProfilePutSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "Invalid body", 400);
  const { branch_id, domain } = parsed.data;
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 수정할 수 없습니다", 403);
  const sel = "id,total_xp,level,current_streak,best_streak,streak_freezes,last_success_date,hp,badges";
  const { data } = await db.from("game_profiles").select(sel).eq("branch_id", branch_id).eq("domain", domain).eq("owner_type", "branch").is("owner_id", null).maybeSingle();
  const prev = data as { id: string; streak_freezes: number; last_success_date: string | null } | null;
  if (parsed.data.use_freeze) {
    if (!prev) return fail(c, "NO_PROFILE", "아직 활동 기록이 없습니다", 400);
    const today = kstDateStr();
    const yest = addDays(today, -1);
    if (prev.last_success_date == null || prev.last_success_date >= yest) return fail(c, "NO_GAP", "복구할 끊긴 연속 기록이 없습니다", 400);
    if (prev.streak_freezes <= 0) return fail(c, "NO_FREEZE", "남은 복구권이 없습니다", 400);
    await db.from("game_profiles").update({ last_success_date: yest, streak_freezes: prev.streak_freezes - 1, updated_at: new Date().toISOString() }).eq("id", prev.id);
    await db.from("reward_events").insert({ branch_id, domain, owner_type: "branch", owner_id: null, user_id: profile.id, event_date: today, reward_type: "recovery", title: "스트릭 복구", message: "복구권을 사용해 연속 기록을 지켰습니다.", xp_bonus: 0 });
  }
  const { data: updated } = await db.from("game_profiles").select(sel).eq("branch_id", branch_id).eq("domain", domain).eq("owner_type", "branch").is("owner_id", null).maybeSingle();
  return ok(c, updated ?? {}, "저장되었습니다");
});

const taskUpdateSchema = z.object({
  status: z.enum(["pending", "in_progress", "done", "skipped", "postponed", "canceled"]).optional(),
  skipped_reason: z.string().nullish(),
  memo: z.string().nullish(),
  actual: z.number().int().min(0).optional(),
});
dailyReportsRoutes.put("/tasks/:id", requireJwt, async (c) => {
  const id = c.req.param("id");
  const parsed = taskUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "Invalid body", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data: row } = await db.from("operation_tasks").select("branch_id, metadata, task_date, status, generated_key, category, title").eq("id", id).maybeSingle();
  if (!row) return fail(c, "NOT_FOUND", "대상을 찾을 수 없습니다", 404);
  const r = row as { branch_id: string; metadata: Record<string, unknown> | null; task_date: string; status: string; generated_key: string | null; category: string; title: string };
  const wasDone = r.status === "done";
  if (!canAccessBranch(profile, r.branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 수정할 수 없습니다", 403);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const meta: Record<string, unknown> = { ...(r.metadata ?? {}) };
  let metaChanged = false;

  if (parsed.data.memo != null) { meta.memo = parsed.data.memo; metaChanged = true; }

  // 진척(actual) — 목표형 회원관리 액션 태스크: 체크리스트 actual 동기화(점수 연동) + 목표 달성 자동완료
  if (parsed.data.actual !== undefined) {
    if (!isWithinEditWindow(r.task_date)) return fail(c, "EDIT_WINDOW", "수정 가능 기간(작성일 당일·익일)이 지났습니다", 400);
    const actionNo = typeof meta.action_no === "number" ? (meta.action_no as number) : null;
    const target = typeof meta.target === "number" ? (meta.target as number) : null;
    const newActual = Math.max(0, parsed.data.actual);
    meta.actual = newActual; metaChanged = true;
    if (actionNo != null) {
      const { data: clRow } = await db.from("daily_checklists").select("items").eq("branch_id", r.branch_id).eq("report_date", r.task_date).maybeSingle();
      const raw = (clRow as { items?: unknown } | null)?.items;
      const items: Record<string, unknown>[] = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
      let found = false;
      const merged = items.map((it) => { if (Number(it.no) === actionNo) { found = true; return { ...it, actual: newActual }; } return it; });
      if (!found) merged.push({ no: actionNo, done: false, actual: newActual, memo: "" });
      await db.from("daily_checklists").upsert(
        { branch_id: r.branch_id, report_date: r.task_date, items: merged, updated_at: new Date().toISOString() },
        { onConflict: "branch_id,report_date" });
    }
    if (target != null && newActual >= target) { patch.status = "done"; patch.completed_at = new Date().toISOString(); patch.completed_by = profile.id; }
  }

  if (parsed.data.status) {
    patch.status = parsed.data.status;
    if (parsed.data.status === "done") { patch.completed_at = new Date().toISOString(); patch.completed_by = profile.id; }
  }
  if (parsed.data.skipped_reason !== undefined) patch.skipped_reason = parsed.data.skipped_reason;
  if (metaChanged) patch.metadata = meta;
  const { error } = await db.from("operation_tasks").update(patch).eq("id", id);
  if (error) return fail(c, "DB_ERROR", error.message, 500);

  // 미션 완료 전이 시 XP/스트릭 적립 (중복 방지: 이전 done 아님 + 이번에 done)
  if (patch.status === "done" && !wasDone) {
    try { await awardGameXp(db, r.branch_id, profile.id, "branch_ops", { taskId: id, title: r.title, xp: taskXp(r.generated_key, r.category) }); }
    catch { /* 보상 적립 실패는 완료 처리를 막지 않음 */ }
  }
  return ok(c, { id }, "저장되었습니다");
});

dailyReportsRoutes.get("/alerts", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id");
  const date = c.req.query("date") ?? kstDateStr();
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data } = await db.from("operation_alerts").select("*").eq("branch_id", branchId).eq("alert_date", date).order("created_at", { ascending: false });
  return ok(c, { alerts: data ?? [] });
});

const alertUpdateSchema = z.object({ status: z.enum(["open", "acknowledged", "resolved", "dismissed"]) });
dailyReportsRoutes.put("/alerts/:id", requireJwt, async (c) => {
  const id = c.req.param("id");
  const parsed = alertUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "Invalid body", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data: row } = await db.from("operation_alerts").select("branch_id").eq("id", id).maybeSingle();
  if (!row) return fail(c, "NOT_FOUND", "대상을 찾을 수 없습니다", 404);
  if (!canAccessBranch(profile, (row as { branch_id: string }).branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 수정할 수 없습니다", 403);
  const patch: Record<string, unknown> = { status: parsed.data.status, updated_at: new Date().toISOString() };
  if (parsed.data.status === "acknowledged") { patch.acknowledged_by = profile.id; patch.acknowledged_at = new Date().toISOString(); }
  if (parsed.data.status === "resolved") { patch.resolved_by = profile.id; patch.resolved_at = new Date().toISOString(); }
  const { error } = await db.from("operation_alerts").update(patch).eq("id", id);
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { id }, "저장되었습니다");
});

// ── 본사 예외 관제 (HQ 전용) — 전 지점 점수·예외 집계 ────────
dailyReportsRoutes.get("/hq-control", requireJwt, async (c) => {
  const date = c.req.query("date") ?? kstDateStr();
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !HQ_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "본사 전용입니다", 403);

  const { data: braw } = await db.from("branches").select("id,name").order("name");
  const branches = (braw as BranchRow[] | null) ?? [];

  const rows = await Promise.all(branches.map(async (b) => {
    let score = (await db.from("branch_daily_scores").select("total_score,grade,summary").eq("branch_id", b.id).eq("score_date", date).maybeSingle()).data as { total_score: number; grade: string | null; summary: string | null } | null;
    if (!score) {
      try { await runGenerate(db, b.id, date, profile.id); } catch { /* 무시: 한 지점 실패가 전체를 막지 않게 */ }
      score = (await db.from("branch_daily_scores").select("total_score,grade,summary").eq("branch_id", b.id).eq("score_date", date).maybeSingle()).data as { total_score: number; grade: string | null; summary: string | null } | null;
    }
    const [rep, tasksR, alertsR, refundR, issueR, summary, leadsR, membersR] = await Promise.all([
      db.from("daily_reports").select("updated_at").eq("branch_id", b.id).eq("report_date", date).maybeSingle(),
      db.from("operation_tasks").select("priority,status").eq("branch_id", b.id).eq("task_date", date),
      db.from("operation_alerts").select("severity,status").eq("branch_id", b.id).eq("alert_date", date),
      db.from("refund_requests").select("id").eq("branch_id", b.id).not("refund_status", "in", "(completed,canceled,rejected)"),
      db.from("issue_tickets").select("id").eq("branch_id", b.id).in("status", ["open", "in_progress", "waiting_vendor"]),
      computeSummary(db, b.id, date),
      db.from("lead_inquiries").select("id").eq("branch_id", b.id).eq("status", "inquiry").is("first_contact_at", null),
      db.from("member_snapshots").select("id").eq("branch_id", b.id).gte("end_date", date).lte("end_date", addDays(date, 7)),
    ]);
    const tasks = (tasksR.data as { priority: string; status: string }[] | null) ?? [];
    const alerts = (alertsR.data as { severity: string; status: string }[] | null) ?? [];
    const active = tasks.filter((t) => t.status !== "done" && t.status !== "canceled" && t.status !== "skipped");
    return {
      branch_id: b.id, branch_name: b.name,
      total_score: score?.total_score ?? null, grade: score?.grade ?? null, summary: score?.summary ?? null,
      report_submitted: !!rep.data, last_report_at: (rep.data as { updated_at?: string } | null)?.updated_at ?? null,
      tasks_total: tasks.length, tasks_done: tasks.filter((t) => t.status === "done").length,
      must_do_open: active.filter((t) => t.priority === "urgent" || t.priority === "high").length,
      danger_alerts: alerts.filter((a) => (a.severity === "danger" || a.severity === "critical") && a.status !== "resolved" && a.status !== "dismissed").length,
      refund_pending: ((refundR.data as unknown[] | null) ?? []).length,
      facility_open: ((issueR.data as unknown[] | null) ?? []).length,
      unanswered_leads: ((leadsR.data as unknown[] | null) ?? []).length,
      expiring_members: ((membersR.data as unknown[] | null) ?? []).length,
      day_net: summary.day_net, month_achievement: summary.achievement == null ? null : Math.round(summary.achievement * 100), target_amount: summary.target_amount, gap: summary.gap, d_day: summary.d_day,
    };
  }));

  const summary = {
    total: rows.length,
    safe: rows.filter((r) => r.grade === "safe").length,
    watch: rows.filter((r) => r.grade === "watch").length,
    danger: rows.filter((r) => r.grade === "danger").length,
    no_report: rows.filter((r) => !r.report_submitted).length,
    refund_pending: rows.filter((r) => r.refund_pending > 0).length,
    facility: rows.filter((r) => r.facility_open > 0).length,
    fc_unanswered: rows.filter((r) => r.unanswered_leads > 0).length,
    fc_expiring: rows.filter((r) => r.expiring_members > 0).length,
  };
  return ok(c, { date, summary, branches: rows });
});

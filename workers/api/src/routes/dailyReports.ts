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

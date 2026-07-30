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
import {
  normalizeMemberForCare, buildMemberCareProfile,
  type RawSnapshot, type CareContext, type CareProfileDraft, type MemberCareBucket,
} from "../lib/memberRevenueEngine";
import { sendSms, sendFriendTalk } from "../services/smsNotifier";
import { analyzeMemberV5, type V5MemberInput } from "../lib/fcV5Engine";

export const dailyReportsRoutes = new Hono<{ Bindings: Env }>();

const HQ_ROLES = new Set(["super_admin", "hq_admin"]);
const WRITE_ROLES = new Set(["super_admin", "hq_admin", "branch_owner", "branch_manager"]);
// 회원관리(퀘스트·문자·태스크완료)는 코치도 자기 지점 한정 허용 — canAccessBranch로 지점 스코프 보장.
const CARE_ROLES = new Set(["super_admin", "hq_admin", "branch_owner", "branch_manager", "coach"]);
// 마스터(본사) 계정은 관전자 — 개인 점수를 적립하지 않는다. 지점 XP·활동 감사로그는 그대로 남긴다.
// reward_events.user_id 를 null 로 넣으면 직원 점수판(개인 집계)에서 자연히 빠진다.
const scoreUserId = (profile: { id: string; role: string }): string | null =>
  HQ_ROLES.has(profile.role) ? null : profile.id;

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

// ── 기간(일/주/월) 통계 — 데이터 통계 보드용 ────────────────────
interface PeriodRep {
  report_date: string;
  revenue_pt: number; revenue_membership: number; revenue_goods: number; revenue_dan: number;
  refund_amount: number | null; refund_count: number | null;
  inquiry_count: number; new_signups: number; re_signups: number; pending_count: number;
  morning_attendance: number; lunch_attendance: number; evening_attendance: number;
}
function periodAddDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
function periodMonthRange(date: string): { start: string; end: string } {
  const y = Number(date.slice(0, 4)); const m = Number(date.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${date.slice(0, 7)}-01`, end: `${date.slice(0, 7)}-${String(last).padStart(2, "0")}` };
}
/**
 * 결산 월 범위 — 지점 결산 시작일(fiscal_start_day) 기준.
 * startDay=1 이면 달력월과 동일. 13이면 13일~다음달 12일.
 * anchor 가 속한 결산월을 반환한다.
 */
function fiscalMonthRange(date: string, startDay: number): { start: string; end: string } {
  if (!startDay || startDay <= 1) return periodMonthRange(date);
  const y = Number(date.slice(0, 4)); const m = Number(date.slice(5, 7)); const d = Number(date.slice(8, 10));
  // anchor 가 startDay 이전이면 직전 달이 시작
  const sy = d >= startDay ? y : (m === 1 ? y - 1 : y);
  const sm = d >= startDay ? m : (m === 1 ? 12 : m - 1);
  const startD = new Date(Date.UTC(sy, sm - 1, startDay));
  const endD = new Date(Date.UTC(sy, sm, startDay)); // 다음 시작일
  endD.setUTCDate(endD.getUTCDate() - 1);            // 하루 전 = 종료일
  return { start: startD.toISOString().slice(0, 10), end: endD.toISOString().slice(0, 10) };
}
async function aggPeriod(db: ReturnType<typeof getServiceClient>, branchId: string, start: string, end: string): Promise<PeriodRep[]> {
  const { data } = await db.from("daily_reports")
    .select("report_date,revenue_pt,revenue_membership,revenue_goods,revenue_dan,refund_amount,refund_count,inquiry_count,new_signups,re_signups,pending_count,morning_attendance,lunch_attendance,evening_attendance")
    .eq("branch_id", branchId).gte("report_date", start).lte("report_date", end).order("report_date");
  return (data as PeriodRep[] | null) ?? [];
}

dailyReportsRoutes.get("/period-stats", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id");
  const period = (c.req.query("period") ?? "month") as "day" | "week" | "month";
  const anchor = c.req.query("date") ?? kstDateStr();
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);

  // 지점 결산 시작일(기본 1일 = 달력월, 역삼 등은 13일)
  const { data: brRow } = await db.from("branches").select("fiscal_start_day").eq("id", branchId).maybeSingle();
  const fiscalStart = Number((brRow as { fiscal_start_day?: number } | null)?.fiscal_start_day ?? 1) || 1;

  // 기간 범위 + 직전 비교 범위
  let start: string, end: string, pStart: string, pEnd: string;
  if (period === "day") {
    start = end = anchor;
    pStart = pEnd = periodAddDays(anchor, -1);
  } else if (period === "week") {
    end = anchor; start = periodAddDays(anchor, -6);
    pEnd = periodAddDays(anchor, -7); pStart = periodAddDays(anchor, -13);
  } else {
    const r = fiscalMonthRange(anchor, fiscalStart); start = r.start; end = r.end;
    const pr = fiscalMonthRange(periodAddDays(r.start, -1), fiscalStart); pStart = pr.start; pEnd = pr.end;
  }

  const [reps, pReps, { data: clRaw }, { data: seRaw }, { data: ptRaw }, { count: expCount }] = await Promise.all([
    aggPeriod(db, branchId, start, end),
    aggPeriod(db, branchId, pStart, pEnd),
    db.from("daily_checklists").select("items").eq("branch_id", branchId).gte("report_date", start).lte("report_date", end),
    db.from("sales_entries").select("payment_method,amount").eq("branch_id", branchId).gte("sale_date", start).lte("sale_date", end),
    db.from("pt_passes").select("payment_method,amount").eq("branch_id", branchId).gte("reg_date", start).lte("reg_date", end),
    db.from("member_snapshots").select("id", { count: "exact", head: true }).eq("branch_id", branchId).gte("end_date", start).lte("end_date", end),
  ]);

  const sum = (rs: PeriodRep[], f: (r: PeriodRep) => number): number => rs.reduce((s, r) => s + f(r), 0);
  const grossOf = (r: PeriodRep): number => r.revenue_pt + r.revenue_membership + r.revenue_goods + r.revenue_dan;
  const netOf = (r: PeriodRep): number => grossOf(r) - (r.refund_amount ?? 0);
  const gross = sum(reps, grossOf);
  const refund = sum(reps, (r) => r.refund_amount ?? 0);

  let care = 0;
  for (const row of (clRaw as { items: { no: number; actual?: number }[] }[] | null) ?? []) {
    for (const it of row.items ?? []) if (it.no >= 1 && it.no <= 3) care += it.actual ?? 0;
  }

  const ses = (seRaw as { payment_method: string; amount: number }[] | null) ?? [];
  const pts = (ptRaw as { payment_method: string | null; amount: number }[] | null) ?? [];
  const payBy = (m: string): number =>
    ses.filter((s) => s.payment_method === m).reduce((a, s) => a + s.amount, 0) +
    pts.filter((p) => p.payment_method === m).reduce((a, p) => a + p.amount, 0);

  return ok(c, {
    period, start, end, days_reported: reps.length, fiscal_start_day: fiscalStart,
    net: gross - refund, gross, refund, refund_count: sum(reps, (r) => r.refund_count ?? 0),
    revenue: {
      pt: sum(reps, (r) => r.revenue_pt), membership: sum(reps, (r) => r.revenue_membership),
      goods: sum(reps, (r) => r.revenue_goods), dan: sum(reps, (r) => r.revenue_dan),
    },
    payment: { cash: payBy("현금"), card: payBy("카드"), transfer: payBy("계좌이체") },
    pipeline: {
      inquiry: sum(reps, (r) => r.inquiry_count), new_signups: sum(reps, (r) => r.new_signups),
      re_signups: sum(reps, (r) => r.re_signups), pending: sum(reps, (r) => r.pending_count),
    },
    member_care: care,
    expiring: expCount ?? 0,
    attendance_avg: reps.length ? Math.round(sum(reps, (r) => r.morning_attendance + r.lunch_attendance + r.evening_attendance) / reps.length) : 0,
    daily: reps.map((r) => ({ date: r.report_date, net: netOf(r), new_signups: r.new_signups, re_signups: r.re_signups, inquiry: r.inquiry_count })),
    prev: {
      net: sum(pReps, netOf), new_signups: sum(pReps, (r) => r.new_signups),
      re_signups: sum(pReps, (r) => r.re_signups), inquiry: sum(pReps, (r) => r.inquiry_count),
    },
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

// ── 회원 조회 (환불 계산기 자동채움용) ─────────────────────────
// member_snapshots(브로제이 임포트)에서 이름·연락처로 검색. 지점 스코프 게이트.
dailyReportsRoutes.get("/member-lookup", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id");
  const qRaw = c.req.query("q") ?? "";
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);

  // PostgREST or() 필터 안전: 구분자·와일드카드 제거
  const q = qRaw.replace(/[,()*%"\\]/g, "").trim();
  const cols = "id,member_name,phone,product_name,membership_type,start_date,end_date,total_sessions,used_sessions,remaining_sessions,payment_amount,payment_method,status,latest_visit_date,raw_payload";
  let query = db.from("member_snapshots").select(cols).eq("branch_id", branchId);
  if (q) query = query.or(`member_name.ilike.%${q}%,phone.ilike.%${q}%`);
  const { data, error } = await query.order("member_name").limit(20);
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  // raw_payload.__locker / __rental (락커·대여권 파일에서 주입) → locker/rental 로 노출, raw_payload 는 응답에서 제거.
  const pickRp = (rp: Record<string, unknown>, k: string): { amount: number; start: string | null; end: string | null } | null => {
    const v = rp[k] as { amount?: number; start?: string | null; end?: string | null } | undefined;
    return v && typeof v.amount === "number" && v.amount > 0 ? { amount: v.amount, start: v.start ?? null, end: v.end ?? null } : null;
  };
  const members = ((data as Record<string, unknown>[] | null) ?? []).map((m) => {
    const rp = (m.raw_payload ?? {}) as Record<string, unknown>;
    const out = { ...m, locker: pickRp(rp, "__locker"), rental: pickRp(rp, "__rental") };
    delete (out as { raw_payload?: unknown }).raw_payload;
    return out;
  });
  return ok(c, { members });
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

  // 2) 기존 스냅샷 전화 정규화 맵 — 1000행 초과 지점도 전수 조회 (PostgREST 기본 1000행 한도 우회).
  const byPhone = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data: chunk } = await db.from("member_snapshots").select("id,normalized_phone").eq("branch_id", branch_id).range(from, from + 999);
    const arr = (chunk as { id: string; normalized_phone: string | null }[] | null) ?? [];
    for (const e of arr) { if (e.normalized_phone) byPhone.set(e.normalized_phone, e.id); }
    if (arr.length < 1000) break;
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

  // 5) 반영 — 500행씩 청크로 나눠 병렬 처리(대용량 4000+도 타임아웃·페이로드 초과 없이). normalized_phone 은 생성열이라 쓰지 않음.
  const CHUNK = 500;
  const chunksOf = <T>(arr: T[]): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
    return out;
  };
  let imported = 0; let failed = 0; let inserted = 0; let updated = 0;
  const insRes = await Promise.all(chunksOf(toInsert).map(async (part) => {
    const { error } = await db.from("member_snapshots").insert(part);
    return { n: part.length, ok: !error };
  }));
  for (const r of insRes) { if (r.ok) { imported += r.n; inserted += r.n; } else failed += r.n; }
  const updRes = await Promise.all(chunksOf(toUpdate).map(async (part) => {
    const { error } = await db.from("member_snapshots").upsert(part, { onConflict: "id" });
    return { n: part.length, ok: !error };
  }));
  for (const r of updRes) { if (r.ok) { imported += r.n; updated += r.n; } else failed += r.n; }

  if (jobId) {
    await db.from("import_jobs").update({
      status: failed > 0 && imported === 0 ? "failed" : "imported",
      imported_rows: imported, failed_rows: failed, completed_at: new Date().toISOString(),
    }).eq("id", jobId);
  }
  return ok(c, { job_id: jobId, total: rows.length, deduped: dedup.length, imported, updated, inserted, failed }, `${imported}명 반영 완료`);
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
    // ⚠️ 출석 빈도(visits_*)·홀딩(hold_*)을 빠뜨리면 화면에서 '출석 미동기화'로 보인다.
    //    DB엔 값이 있는데 API가 안 보내는 상황 — 새 컬럼을 추가하면 여기도 같이 늘려야 한다.
    .select("id,member_name,phone,product_name,membership_type,end_date,latest_visit_date,start_date,remaining_sessions,status,assigned_coach,updated_at,visits_7d,visits_30d,visits_90d,hold_status,hold_start,hold_end")
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
  if (!profile || !CARE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
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
    .select("id,recipient_name,phone,template_type,content,status,created_by,created_at")
    .eq("branch_id", branchId)
    .order("created_at", { ascending: false })
    .limit(500);
  return ok(c, { messages: data ?? [] });
});

// ── 지점 직원 목록 (공동 회원관리 담당자 = 지점장·FC 등) ──
dailyReportsRoutes.get("/staff", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id");
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data } = await db
    .from("profiles")
    .select("id,role,name,status")
    .eq("branch_id", branchId)
    .in("role", ["branch_owner", "branch_manager", "coach"])
    .eq("status", "active")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  return ok(c, { staff: data ?? [] });
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

// ── 직원(지점장·코치) 점수판 — AI 지점관리 미션 수행 기반. 본사=전지점 / 관장=본인지점 ──
dailyReportsRoutes.get("/staff-scores", requireJwt, async (c) => {
  const period = c.req.query("period") === "week" ? "week" : "month";
  const qBranch = c.req.query("branch_id") || null;
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  const isHq = HQ_ROLES.has(profile.role);
  // 관장/지도자는 본인 지점만. 본사는 전지점(또는 선택지점). 코치는 열람 불가(본인은 미션 수행자).
  if (!isHq && !["branch_owner", "branch_manager"].includes(profile.role)) return fail(c, "FORBIDDEN", "점수판은 본사·관장만 볼 수 있습니다", 403);
  const scopeBranch = isHq ? qBranch : profile.branch_id;
  if (!isHq && qBranch && qBranch !== profile.branch_id) return fail(c, "FORBIDDEN", "다른 지점은 볼 수 없습니다", 403);

  const today = kstDateStr();
  const from = period === "week" ? addDays(today, -6) : `${today.slice(0, 7)}-01`;
  const { data, error } = await db.rpc("ops_staff_scores", { _from: from, _to: today, _branch: scopeBranch });
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  type Row = { user_id: string; name: string | null; role: string; branch_id: string; branch_name: string | null; xp: number; activities: number; active_days: number; last_active: string | null };
  const rows = ((data as Row[] | null) ?? [])
    .filter((r) => !HQ_ROLES.has(r.role)) // 마스터(본사)는 관전자 — 점수판·순위에서 제외
    .map((r) => ({ ...r, xp: Number(r.xp), activities: Number(r.activities), active_days: Number(r.active_days) }));
  rows.sort((a, b) => b.xp - a.xp || b.activities - a.activities);
  return ok(c, { period, from, to: today, staff: rows });
});

// 주간 목표 점수(역할별). 실측 평균(코치 ~235/주, 관장 ~46/주) 기준으로 잡았고, 운영하며 조정한다.
const WEEKLY_GOAL: Record<string, number> = {
  coach: 250,
  branch_manager: 150,
  branch_owner: 150,
  hq_admin: 150,
  super_admin: 150,
};

// ── 직원 점수판 상세(상황판) — 일별 추이·카테고리 분해·전기간 대비·목표 달성률을 한 번에 ──
//    reward_events 원본을 현재+직전 동일기간으로 읽어 워커에서 집계한다(직원 수십 명 규모라 가볍다).
dailyReportsRoutes.get("/staff-scores/detail", requireJwt, async (c) => {
  const period = c.req.query("period") === "week" ? "week" : "month";
  const qBranch = c.req.query("branch_id") || null;
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  const isHq = HQ_ROLES.has(profile.role);
  if (!isHq && !["branch_owner", "branch_manager"].includes(profile.role)) return fail(c, "FORBIDDEN", "점수판은 본사·관장만 볼 수 있습니다", 403);
  const scopeBranch = isHq ? qBranch : profile.branch_id;
  if (!isHq && qBranch && qBranch !== profile.branch_id) return fail(c, "FORBIDDEN", "다른 지점은 볼 수 없습니다", 403);

  const to = kstDateStr();
  const from = period === "week" ? addDays(to, -6) : `${to.slice(0, 7)}-01`;
  const spanDays = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(spanDays - 1));

  let q = db.from("reward_events")
    .select("user_id, branch_id, event_date, xp_bonus, title, metadata")
    .not("user_id", "is", null)
    .gte("event_date", prevFrom).lte("event_date", to)
    .limit(20000);
  if (scopeBranch) q = q.eq("branch_id", scopeBranch);
  const { data, error } = await q;
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  type Ev = { user_id: string; branch_id: string; event_date: string; xp_bonus: number | null; title: string | null; metadata: Record<string, unknown> | null };
  const evs = (data as Ev[] | null) ?? [];

  // 카테고리: 케어 완료는 metadata.category(member_care/renewal/...) — 없으면 제목으로(보너스/운영미션)
  const catOf = (e: Ev): string => {
    const m = (e.metadata?.["category"] as string | undefined) ?? "";
    if (m) return m;
    if ((e.title ?? "").includes("보너스")) return "bonus";
    return "mission";
  };

  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const dayIdx = new Map(days.map((d, i) => [d, i] as const));

  type Agg = { xp: number; prev_xp: number; activities: number; dset: Set<string>; last: string | null; byDay: number[]; byCat: Record<string, number>; branch_id: string };
  const byUser = new Map<string, Agg>();
  for (const e of evs) {
    let a = byUser.get(e.user_id);
    if (!a) { a = { xp: 0, prev_xp: 0, activities: 0, dset: new Set(), last: null, byDay: days.map(() => 0), byCat: {}, branch_id: e.branch_id }; byUser.set(e.user_id, a); }
    const xp = Number(e.xp_bonus ?? 0);
    if (e.event_date >= from) {
      a.xp += xp; a.activities += 1; a.dset.add(e.event_date);
      if (!a.last || e.event_date > a.last) a.last = e.event_date;
      const i = dayIdx.get(e.event_date); if (i != null) a.byDay[i] = (a.byDay[i] ?? 0) + xp;
      const cat = catOf(e); a.byCat[cat] = (a.byCat[cat] ?? 0) + xp;
      a.branch_id = e.branch_id;
    } else {
      a.prev_xp += xp;
    }
  }

  const ids = Array.from(byUser.keys());
  const profMap = new Map<string, { name: string | null; role: string }>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data: ps } = await db.from("profiles").select("id, name, role").in("id", ids.slice(i, i + 100));
    for (const pr of (ps as { id: string; name: string | null; role: string }[] | null) ?? []) profMap.set(pr.id, { name: pr.name, role: pr.role });
  }
  const { data: brs } = await db.from("branches").select("id, name");
  const brName = new Map(((brs as { id: string; name: string | null }[] | null) ?? []).map((b) => [b.id, b.name] as const));

  const staff = ids.map((uid) => {
    const a = byUser.get(uid)!;
    const pr = profMap.get(uid);
    const role = pr?.role ?? "coach";
    // 목표 = 역할별 주간 목표(실측 평균 기반)를 기간 길이에 비례 환산
    const goal = Math.max(1, Math.round((WEEKLY_GOAL[role] ?? 150) * (spanDays / 7)));
    return {
      user_id: uid, name: pr?.name ?? null, role,
      branch_id: a.branch_id, branch_name: brName.get(a.branch_id) ?? null,
      xp: a.xp, prev_xp: a.prev_xp, activities: a.activities, active_days: a.dset.size,
      last_active: a.last, goal, by_day: a.byDay, by_cat: a.byCat,
    };
  }).filter((r) => (r.xp > 0 || r.prev_xp > 0) && !HQ_ROLES.has(r.role)); // 마스터(본사)는 관전자 — 과거 누적분 포함 집계·순위 제외
  staff.sort((x, y) => y.xp - x.xp || y.activities - x.activities);

  return ok(c, { period, from, to, days, staff });
});

// ── 내 점수 (코치·지점장 본인용) ──
// 점수판(/staff-scores)은 본사·관장 전용이라 코치가 자기 점수를 볼 수 없었다.
// 여기서는 **본인 수치만** 돌려준다(타인 이름·점수 미노출). 순위는 같은 지점 내 익명 등수만.
dailyReportsRoutes.get("/my-score", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  if (!CARE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (HQ_ROLES.has(profile.role)) return ok(c, { week: null, month: null }); // 마스터는 관전자 — 개인 점수 없음
  if (!profile.branch_id) return ok(c, { week: null, month: null });

  const today = kstDateStr();
  const weekFrom = addDays(today, -6);
  const monthFrom = `${today.slice(0, 7)}-01`;
  type Row = { user_id: string; xp: number; activities: number; active_days: number; last_active: string | null };
  const pick = (rows: Row[] | null) => {
    const list = ((rows ?? []) as Row[]).map((r) => ({ ...r, xp: Number(r.xp), activities: Number(r.activities), active_days: Number(r.active_days) }));
    list.sort((a, b) => b.xp - a.xp || b.activities - a.activities);
    const idx = list.findIndex((r) => r.user_id === profile.id);
    const me = idx >= 0 ? list[idx] : null;
    return {
      xp: me?.xp ?? 0,
      activities: me?.activities ?? 0,
      active_days: me?.active_days ?? 0,
      last_active: me?.last_active ?? null,
      rank: idx >= 0 ? idx + 1 : null,      // 같은 지점 내 등수(이름은 안 준다)
      total: list.length,
      top_xp: list[0] ? Number(list[0].xp) : 0, // 1위 점수(익명) — "얼마 남았나" 표시용
    };
  };
  // 최근 60일 활동일 → 연속 기록(streak). 오늘 아직 안 했으면 어제 기준으로 이어서 센다.
  const { data: dayRows } = await db
    .from("reward_events")
    .select("event_date")
    .eq("user_id", profile.id)
    .gte("event_date", addDays(today, -60))
    .order("event_date", { ascending: false });
  const dayset = new Set(((dayRows as { event_date: string }[] | null) ?? []).map((r) => r.event_date));
  const doneToday = dayset.has(today);
  let streak = 0;
  let cursor = doneToday ? today : addDays(today, -1);
  while (dayset.has(cursor)) { streak++; cursor = addDays(cursor, -1); }

  const [{ data: w }, { data: m }] = await Promise.all([
    db.rpc("ops_staff_scores", { _from: weekFrom, _to: today, _branch: profile.branch_id }),
    db.rpc("ops_staff_scores", { _from: monthFrom, _to: today, _branch: profile.branch_id }),
  ]);
  return ok(c, {
    role: profile.role,
    goal_weekly: WEEKLY_GOAL[profile.role] ?? 150,
    streak,
    done_today: doneToday,
    week: { from: weekFrom, to: today, ...pick(w as Row[] | null) },
    month: { from: monthFrom, to: today, ...pick(m as Row[] | null) },
  });
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

  // 회원 매출 엔진 연동: 중요한 회원매출 액션을 operation_tasks 에 함께 생성(오늘 3대 미션 반영). 실패는 비차단.
  try { await runMemberCareGenerate(db, branchId, date, profileId); } catch { /* 회원 엔진 실패가 오늘 생성을 막지 않음 */ }

  return { tasks: taskDrafts.length, alerts: alertDrafts.length, score };
}

const opsGenSchema = z.object({ branch_id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() });
dailyReportsRoutes.post("/ops/generate", requireJwt, async (c) => {
  const parsed = opsGenSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !CARE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
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
async function awardGameXp(db: SupabaseClient, branchId: string, profileId: string, domain: string, opts: { taskId?: string; title: string; xp: number; exempt?: boolean }) {
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
  await db.from("reward_events").insert({ branch_id: branchId, domain, owner_type: "branch", owner_id: null, user_id: opts.exempt ? null : profileId, event_date: today, reward_type: "xp", title: "미션 완료", message: opts.title, xp_bonus: opts.xp, related_task_id: opts.taskId ?? null });
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
    await db.from("reward_events").insert({ branch_id, domain, owner_type: "branch", owner_id: null, user_id: scoreUserId(profile), event_date: today, reward_type: "recovery", title: "스트릭 복구", message: "복구권을 사용해 연속 기록을 지켰습니다.", xp_bonus: 0 });
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
  if (!profile || !CARE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
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
    try { await awardGameXp(db, r.branch_id, profile.id, "branch_ops", { taskId: id, title: r.title, xp: taskXp(r.generated_key, r.category), exempt: HQ_ROLES.has(profile.role) }); }
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

// ============================================================
// Member Revenue Engine v1 — 회원 매출 엔진
// member_care_profiles / member_care_events / member_revenue_opportunities
// ============================================================
const CARE_SUCCESS_OUTCOMES = new Set(["reached", "renewed", "pt_sold", "winback_success", "trial_booked", "visit_booked", "pt_consult_booked"]);
const CARE_PURCHASE_OUTCOMES = new Set(["renewed", "pt_sold", "winback_success"]);
const CARE_ACTIONABLE_BUCKETS: MemberCareBucket[] = ["renewal_today", "checkin_today", "pt_upsell", "onboarding_care", "winback", "vip_referral"];
const REVENUE_BUCKETS = new Set<MemberCareBucket>(["renewal_today", "pt_upsell", "winback", "vip_referral"]);

interface CareSummaryOut {
  total_members: number; action_needed_count: number; urgent_count: number; renewal_due_count: number;
  no_visit_count: number; dormant_count: number; pt_upsell_count: number; expected_revenue_total: number;
  won_revenue_today: number; contact_done_today: number; contact_target_today: number;
}
function buildCareSummary(builtList: { profile: CareProfileDraft }[], events: { outcome: string; amount: number; event_date: string }[], date: string): CareSummaryOut {
  let action = 0, urgent = 0, renewal = 0, noVisit = 0, dormant = 0, pt = 0, expected = 0, target = 0;
  for (const b of builtList) {
    const p = b.profile;
    if (CARE_ACTIONABLE_BUCKETS.includes(p.care_bucket)) { action++; expected += p.expected_revenue_amount; }
    if (p.contact_priority === "urgent") urgent++;
    if (p.care_bucket === "renewal_today") renewal++;
    if (p.care_bucket === "checkin_today") noVisit++;
    if (p.care_bucket === "winback") dormant++;
    if (p.care_bucket === "pt_upsell") pt++;
    if (p.next_contact_due_date && p.next_contact_due_date <= date) target++;
  }
  let won = 0, done = 0;
  for (const e of events) if (e.event_date === date) { done++; if (CARE_PURCHASE_OUTCOMES.has(e.outcome)) won += e.amount ?? 0; }
  return { total_members: builtList.length, action_needed_count: action, urgent_count: urgent, renewal_due_count: renewal,
    no_visit_count: noVisit, dormant_count: dormant, pt_upsell_count: pt, expected_revenue_total: expected,
    won_revenue_today: won, contact_done_today: done, contact_target_today: target };
}

interface CareEventRow { member_care_profile_id: string; outcome: string; amount: number; event_date: string; next_action_date: string | null }
interface AfterProfRow { id: string; normalized_phone: string; contact_priority: string; care_bucket: string; member_name: string; phone: string | null; next_best_action: string | null; reasons: unknown }

/** member_snapshots(브로제이) + fc_member_inputs(FC 수기) → V5 엔진 입력. 입력행이 있으면 해당 값으로 보강. */
function snapshotToV5Input(s: RawSnapshot, inp?: Record<string, unknown>): V5MemberInput {
  const g = (k: string): unknown => (inp ? inp[k] : undefined);
  const has = (v: unknown): boolean => v !== null && v !== undefined && v !== "";
  const or = <T,>(v: unknown, fb: T): T => (has(v) ? (v as T) : fb);
  return {
    member_id: s.id,
    member_name: s.member_name,
    phone: s.phone,
    first_join_date: has(g("first_join_date")) ? (g("first_join_date") as string) : s.start_date,
    join_date: s.start_date,
    end_date: s.end_date,
    last_visit_date: s.latest_visit_date,
    target_visits_per_week: or(g("target_visits_per_week"), 2),
    visits_7d: g("visits_7d") as number | null, visits_14d: g("visits_14d") as number | null,
    visits_30d: g("visits_30d") as number | null, visits_90d: g("visits_90d") as number | null,
    previous_30d_visits: g("previous_30d_visits") as number | null,
    satisfaction: g("satisfaction") as number | null,
    complaint: g("complaint") as boolean | null, payment_issue: g("payment_issue") as boolean | null,
    ad_consent: g("ad_consent") as boolean | null, opt_out: g("opt_out") as boolean | null, do_not_contact: g("do_not_contact") as boolean | null,
    goal: g("goal") as string | null, barrier: g("barrier") as string | null,
    membership_revenue: or(g("membership_revenue"), s.payment_amount ?? 0),
    pt_revenue: or(g("pt_revenue"), 0), other_revenue: or(g("other_revenue"), 0), refund: or(g("refund"), 0),
    referral_inquiries: g("referral_inquiries") as number | null, referral_registrations: g("referral_registrations") as number | null,
    referral_revenue: g("referral_revenue") as number | null, reviews: g("reviews") as number | null, community_contribution: g("community_contribution") as number | null,
    gift_cost_365d: g("gift_cost_365d") as number | null, last_vip_care_date: g("last_vip_care_date") as string | null,
    manual_vip_tier: g("manual_vip_tier") as string | null, preferred_gift_key: g("preferred_gift_key") as string | null,
    end_reason: g("end_reason") as string | null, return_interest: g("return_interest") as string | null, return_declined: g("return_declined") as boolean | null,
    recontact_date: g("recontact_date") as string | null, last_post_end_contact_date: g("last_post_end_contact_date") as string | null,
    post_end_sales_contacts_90d: g("post_end_sales_contacts_90d") as number | null,
  };
}

/** 회원 매출 엔진 실행: 스냅샷 → 프로필/기회 upsert + 중요 액션 태스크 생성 */
async function runMemberCareGenerate(db: SupabaseClient, branchId: string, date: string, profileId: string) {
  // 1) 회원 스냅샷
  const { data: snapRaw } = await db.from("member_snapshots")
    .select("id,member_name,phone,normalized_phone,product_name,membership_type,start_date,end_date,total_sessions,used_sessions,remaining_sessions,latest_visit_date,payment_amount,status")
    .eq("branch_id", branchId).limit(5000);
  const snaps = (snapRaw as RawSnapshot[] | null) ?? [];

  // 2) 기존 프로필(id↔phone) + 최근 이벤트 신호
  const { data: existProfRaw } = await db.from("member_care_profiles").select("id,normalized_phone").eq("branch_id", branchId);
  const phoneByProfId = new Map<string, string>();
  for (const p of (existProfRaw as { id: string; normalized_phone: string }[] | null) ?? []) phoneByProfId.set(p.id, p.normalized_phone);

  const since14 = addDays(date, -14); const since7 = addDays(date, -7);
  const { data: evRaw } = await db.from("member_care_events")
    .select("member_care_profile_id,outcome,amount,event_date,next_action_date").eq("branch_id", branchId).gte("event_date", since14);
  const events = (evRaw as CareEventRow[] | null) ?? [];
  const recentSuccessPhones = new Set<string>(); const recentPurchasePhones = new Set<string>(); const dueFollowupPhones = new Set<string>();
  for (const e of events) {
    const ph = phoneByProfId.get(e.member_care_profile_id); if (!ph) continue;
    if (CARE_SUCCESS_OUTCOMES.has(e.outcome)) recentSuccessPhones.add(ph);
    if (CARE_PURCHASE_OUTCOMES.has(e.outcome) && e.event_date >= since7) recentPurchasePhones.add(ph);
    if (e.next_action_date && e.next_action_date <= date && CARE_SUCCESS_OUTCOMES.has(e.outcome)) dueFollowupPhones.add(ph);
  }

  // 3) 지점 평균 결제금액
  const pays = snaps.map((s) => s.payment_amount ?? 0).filter((n) => n > 0);
  const branchAvgPayment = pays.length ? Math.round(pays.reduce((a, b) => a + b, 0) / pays.length) : 0;
  const ctx: CareContext = { today: date, branchAvgPayment, recentSuccessPhones, recentPurchasePhones, dueFollowupPhones };

  // 4) 빌드 (순수 엔진)
  const built = snaps.map((s) => buildMemberCareProfile(normalizeMemberForCare(s), ctx));

  // 4b) V5 엔진 — 스냅샷 + fc_member_inputs(FC 수기) 병합해 회원별 V5(등급·복귀·기프트·게이트) 계산
  const { data: inputRaw } = await db.from("fc_member_inputs").select("*").eq("branch_id", branchId);
  const inputsByPhone = new Map<string, Record<string, unknown>>();
  for (const r of (inputRaw as Record<string, unknown>[] | null) ?? []) {
    const ph = String(r.normalized_phone ?? "");
    if (ph) inputsByPhone.set(ph, r);
  }
  const v5List = built.map((b, i) =>
    analyzeMemberV5(snapshotToV5Input(snaps[i]!, inputsByPhone.get(b.profile.normalized_phone)), { settings: { today: date } }));

  // 5) 프로필 upsert (branch_id, normalized_phone) — 청크 500
  const nowIso = new Date().toISOString();
  const profileRows = built.map((b, i) => ({
    branch_id: branchId, member_snapshot_id: b.profile.member_snapshot_id, normalized_phone: b.profile.normalized_phone, phone: b.profile.phone,
    member_name: b.profile.member_name, product_name: b.profile.product_name, membership_type: b.profile.membership_type,
    lifecycle_stage: b.profile.lifecycle_stage, care_bucket: b.profile.care_bucket,
    health_score: b.profile.health_score, churn_risk_score: b.profile.churn_risk_score, revenue_opportunity_score: b.profile.revenue_opportunity_score,
    ltv_amount: b.profile.ltv_amount, expected_revenue_amount: b.profile.expected_revenue_amount,
    days_until_expiry: b.profile.days_until_expiry, days_since_last_visit: b.profile.days_since_last_visit, remaining_sessions: b.profile.remaining_sessions,
    next_best_action: b.profile.next_best_action, next_best_offer: b.profile.next_best_offer,
    contact_priority: b.profile.contact_priority, next_contact_due_date: b.profile.next_contact_due_date,
    reasons: b.profile.reasons, metadata: b.profile.metadata,
    v5: v5List[i]!, vip_tier: v5List[i]!.vip_tier, winback_cohort: v5List[i]!.winback_cohort, send_gate: v5List[i]!.send_gate,
    renewal_probability: v5List[i]!.renewal_probability, renewal_band: v5List[i]!.renewal_band, renewal_rule_id: v5List[i]!.renewal_rule_id, days_to_expiry: v5List[i]!.days_to_expiry,
    last_scored_at: nowIso, updated_at: nowIso,
  }));
  let profiles_upserted = 0;
  for (let i = 0; i < profileRows.length; i += 500) {
    const chunk = profileRows.slice(i, i + 500);
    const { error } = await db.from("member_care_profiles").upsert(chunk, { onConflict: "branch_id,normalized_phone" });
    if (!error) profiles_upserted += chunk.length;
  }

  // 6) 프로필 id 재조회(phone→id) + 태스크용 필드
  const { data: afterProfRaw } = await db.from("member_care_profiles")
    .select("id,normalized_phone,contact_priority,care_bucket,member_name,phone,next_best_action,reasons").eq("branch_id", branchId);
  const afterProf = (afterProfRaw as AfterProfRow[] | null) ?? [];
  const idByPhone = new Map<string, string>();
  for (const p of afterProf) idByPhone.set(p.normalized_phone, p.id);

  // 7) 기회 upsert — 기존 stage/converted_sale_id 보존(payload에서 제외), 점수 필드만 갱신
  const { data: existOppRaw } = await db.from("member_revenue_opportunities").select("generated_key,stage").eq("branch_id", branchId);
  const stageByKey = new Map<string, string>();
  for (const o of (existOppRaw as { generated_key: string; stage: string }[] | null) ?? []) stageByKey.set(o.generated_key, o.stage);
  const oppRows: Record<string, unknown>[] = [];
  for (const b of built) {
    const pid = idByPhone.get(b.profile.normalized_phone); if (!pid) continue;
    for (const o of b.opportunities) {
      oppRows.push({
        branch_id: branchId, member_care_profile_id: pid, opportunity_type: o.opportunity_type, title: o.title,
        expected_amount: o.expected_amount, probability: o.probability, priority: o.priority, due_date: o.due_date,
        reason: o.reason, recommended_script_key: o.recommended_script_key, generated_key: o.generated_key,
        stage: stageByKey.get(o.generated_key) ?? "open", updated_at: nowIso,
      });
    }
  }
  let opportunities_upserted = 0;
  for (let i = 0; i < oppRows.length; i += 500) {
    const chunk = oppRows.slice(i, i + 500);
    const { error } = await db.from("member_revenue_opportunities").upsert(chunk, { onConflict: "branch_id,generated_key" });
    if (!error) opportunities_upserted += chunk.length;
  }

  // 8) operation_tasks — urgent/high 회원매출 액션만(Top3 호환), 일자별 멱등
  const ymd = date.replace(/-/g, "");
  const taskRows = afterProf
    .filter((p) => (p.contact_priority === "urgent" || p.contact_priority === "high") && CARE_ACTIONABLE_BUCKETS.includes(p.care_bucket as MemberCareBucket))
    .slice(0, 30)
    .map((p) => {
      const cat = REVENUE_BUCKETS.has(p.care_bucket as MemberCareBucket) ? "sales" : "member_care";
      const reasons = Array.isArray(p.reasons) ? (p.reasons as string[]) : [];
      return {
        branch_id: branchId, task_date: date, category: cat, priority: p.contact_priority,
        title: `${p.next_best_action ?? "회원 연락"}: ${p.member_name}`,
        description: reasons.slice(0, 3).join(" · ") || "회원 매출 관리 액션", action_label: "연락하기",
        source_type: "member_care_profile", source_id: p.id, generated_key: `member_rev_${p.id}_${p.care_bucket}_${ymd}`,
        member_name: p.member_name, member_phone: p.phone ?? null, metadata: { care: true, bucket: p.care_bucket }, created_by: profileId,
      };
    });
  let tasks_upserted = 0;
  if (taskRows.length) {
    const { error } = await db.from("operation_tasks").upsert(taskRows, { onConflict: "branch_id,task_date,generated_key", ignoreDuplicates: true });
    if (!error) tasks_upserted = taskRows.length;
  }

  return { scored: snaps.length, profiles_upserted, opportunities_upserted, tasks_upserted, summary: buildCareSummary(built, events, date) };
}

interface CareKpiOut {
  month: string; contact_rate: number; renewal_conversion: number; winback_rate: number; pt_upsell_rate: number;
  no_visit_recovery: number; expected_vs_won: number; care_revenue_month: number; avg_ticket: number; d14_renewal_managed: number;
}
async function computeMemberCareKpi(db: SupabaseClient, branchId: string, ym: string): Promise<CareKpiOut> {
  const monthStart = `${ym}-01`;
  const lastDay = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  const monthEnd = `${ym}-${String(lastDay).padStart(2, "0")}`;
  const [evR, profR] = await Promise.all([
    db.from("member_care_events").select("member_care_profile_id,outcome,amount").eq("branch_id", branchId).gte("event_date", monthStart).lte("event_date", monthEnd),
    db.from("member_care_profiles").select("care_bucket,expected_revenue_amount").eq("branch_id", branchId),
  ]);
  const evs = (evR.data as { member_care_profile_id: string; outcome: string; amount: number }[] | null) ?? [];
  const profs = (profR.data as { care_bucket: MemberCareBucket; expected_revenue_amount: number }[] | null) ?? [];
  const contacted = new Set(evs.map((e) => e.member_care_profile_id)).size;
  const cnt = (o: string) => evs.filter((e) => e.outcome === o).length;
  const renewed = cnt("renewed"), ptSold = cnt("pt_sold"), winback = cnt("winback_success"), visitBooked = cnt("visit_booked");
  const purchases = renewed + ptSold + winback;
  const careRevenue = evs.filter((e) => CARE_PURCHASE_OUTCOMES.has(e.outcome)).reduce((s, e) => s + (e.amount ?? 0), 0);
  const bc = (b: MemberCareBucket) => profs.filter((p) => p.care_bucket === b).length;
  const actionNeeded = profs.filter((p) => CARE_ACTIONABLE_BUCKETS.includes(p.care_bucket)).length;
  const renewalDue = bc("renewal_today"), dormant = bc("winback"), ptUp = bc("pt_upsell"), noVisit = bc("checkin_today");
  const expectedOpen = profs.filter((p) => CARE_ACTIONABLE_BUCKETS.includes(p.care_bucket)).reduce((s, p) => s + (p.expected_revenue_amount ?? 0), 0);
  const pct = (a: number, b: number) => (b <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((100 * a) / b))));
  return {
    month: ym,
    contact_rate: pct(contacted, Math.max(1, actionNeeded)),
    renewal_conversion: pct(renewed, Math.max(1, renewed + renewalDue)),
    winback_rate: pct(winback, Math.max(1, winback + dormant)),
    pt_upsell_rate: pct(ptSold, Math.max(1, ptSold + ptUp)),
    no_visit_recovery: pct(visitBooked, Math.max(1, visitBooked + noVisit)),
    expected_vs_won: pct(careRevenue, Math.max(1, expectedOpen)),
    care_revenue_month: careRevenue,
    avg_ticket: purchases ? Math.round(careRevenue / purchases) : 0,
    d14_renewal_managed: pct(renewed, Math.max(1, renewed + renewalDue)),
  };
}

// 1) 생성 (W)
const careGenSchema = z.object({ branch_id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() });
dailyReportsRoutes.post("/member-care/generate", requireJwt, async (c) => {
  const parsed = careGenSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, parsed.data.branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 처리할 수 없습니다", 403);
  const date = parsed.data.date ?? kstDateStr();
  const r = await runMemberCareGenerate(db, parsed.data.branch_id, date, profile.id);
  return ok(c, r, "회원 매출 엔진을 실행했습니다");
});

// 1b) V5 큐 (VIP · 복귀 D30/60/90 · 온보딩 + 요약) — member_care_profiles.v5 기반
interface V5QueueRow { id: string; member_name: string; phone: string | null; vip_tier: string | null; winback_cohort: string | null; send_gate: string | null; v5: { priority?: number; lifecycle_stage?: string } | null }
dailyReportsRoutes.get("/member-care/v5", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  const branchId = c.req.query("branch_id") ?? profile.branch_id ?? "";
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);

  const sel = "id,member_name,phone,vip_tier,winback_cohort,send_gate,v5";
  const fetchV5Rows = async (): Promise<V5QueueRow[]> => {
    const { data } = await db.from("member_care_profiles").select(sel).eq("branch_id", branchId);
    return ((data as V5QueueRow[] | null) ?? []).filter((r) => r.v5);
  };
  let rows = await fetchV5Rows();
  // v5 미계산(배포 직후 등)이면 1회 자동 생성 후 재조회 — 새로고침 버튼에 의존하지 않음
  if (rows.length === 0 && WRITE_ROLES.has(profile.role)) {
    try { await runMemberCareGenerate(db, branchId, kstDateStr(), profile.id); } catch { /* 생성 실패가 조회를 막지 않음 */ }
    rows = await fetchV5Rows();
  }
  const VIP = new Set(["SILVER", "GOLD", "BLACK", "AMBASSADOR"]);
  const COH = new Set(["30일", "60일", "90일"]);
  const prio = (r: V5QueueRow) => r.v5?.priority ?? 0;
  const byPrio = (a: V5QueueRow, b: V5QueueRow) => prio(b) - prio(a);
  const vip = rows.filter((r) => VIP.has(r.vip_tier ?? "")).sort(byPrio).slice(0, 40);
  const winback = rows.filter((r) => COH.has(r.winback_cohort ?? "")).sort(byPrio).slice(0, 40);
  const onboarding = rows.filter((r) => r.v5?.lifecycle_stage === "30일 온보딩").sort(byPrio).slice(0, 40);
  const tier = (t: string) => rows.filter((r) => r.vip_tier === t).length;
  const coh = (ch: string) => rows.filter((r) => r.winback_cohort === ch).length;
  const summary = {
    total: rows.length,
    vip_total: rows.filter((r) => VIP.has(r.vip_tier ?? "")).length,
    by_tier: { SILVER: tier("SILVER"), GOLD: tier("GOLD"), BLACK: tier("BLACK"), AMBASSADOR: tier("AMBASSADOR") },
    service_recovery: rows.filter((r) => r.send_gate === "서비스회복만").length,
    winback_30: coh("30일"), winback_60: coh("60일"), winback_90: coh("90일"),
    onboarding: onboarding.length,
    send_blocked: rows.filter((r) => r.send_gate && !["발송가능", "서비스회복만"].includes(r.send_gate)).length,
  };
  return ok(c, { summary, vip, winback, onboarding });
});

// ── V6 재등록 AutoCRM (재등록 확률 큐 · 상품 · 자동화설정 · 이벤트) ──
const STOP_EVENTS_V6 = new Set(["payment_success", "consult_requested", "pause_requested", "optout", "service_issue"]);

interface V6Blob {
  renewal_route?: string; renewal_rule_id?: string; renewal_template_key?: string;
  renewal_product_key?: string; renewal_coupon_key?: string; renewal_gate?: string;
  renewal_probability?: number; renewal_band?: string; expected_revenue?: number; expected_ticket?: number;
  days_to_expiry?: number | null; days_expired?: number;
}
interface V6ProfileRow { id: string; member_name: string; phone: string | null; normalized_phone: string; vip_tier: string | null; send_gate: string | null; v5: V6Blob | null }
interface V6ProductRow { product_key: string; name: string; months: number | null; price: number | null; payment_url: string | null; active: boolean; gift_key: string | null; target: string | null; sort: number | null }
interface V6ConfigRow {
  branch_phone: string; free_optout: string; consult_url: string; coupon_asset_url: string; payment_base_url: string;
  webhook_url: string; kakao_channel_id: string; dry_run: boolean; auto_send_enabled: boolean;
  high_threshold: number; medium_threshold: number; max_ad_contacts_30d: number; min_contact_gap_days: number; send_hour: number; send_minute: number;
}

// 원본 is_data_ready(02_AUTOMATION) — 가격·URL·쿠폰 설정 없으면 발송보류
function renewalDataReady(route: string, gate: string, product: V6ProductRow | null, couponKey: string, cfg: { consult_url?: string; coupon_asset_url?: string } | null): { ready: boolean; warnings: string[] } {
  const w: string[] = [];
  if (!route) return { ready: false, warnings: ["대상 아님"] };
  if (route === "서비스회복") return { ready: false, warnings: ["관리자 확인"] };
  const adOk = gate === "광고발송가능" || gate === "발송가능";
  if (route === "저확률 정보안내") return { ready: adOk || gate === "정보성만", warnings: w };
  if (!adOk) w.push("카카오 광고동의 또는 게이트 확인");
  if (!product || !product.active) w.push("상품 비활성");
  if (!product || Number(product.price ?? 0) <= 0) w.push("상품가격 필요");
  if (!product || !String(product.payment_url ?? "").trim()) w.push("결제URL 필요");
  if (!String(cfg?.consult_url ?? "").trim()) w.push("상담URL 필요");
  if (couponKey !== "NONE" && !String(cfg?.coupon_asset_url ?? "").trim()) w.push("쿠폰 이미지 URL 필요");
  return { ready: w.length === 0, warnings: w };
}

// V6-a) 재등록 확률 큐 (만료예정 D-14~0 · 종료 D1/30/60/90 · 확률순) — member_care_profiles.v5 기반
dailyReportsRoutes.get("/member-care/v6", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  const branchId = c.req.query("branch_id") ?? profile.branch_id ?? "";
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);

  const sel = "id,member_name,phone,normalized_phone,vip_tier,send_gate,v5";
  const fetchRows = async (): Promise<V6ProfileRow[]> => {
    const { data } = await db.from("member_care_profiles").select(sel).eq("branch_id", branchId);
    return ((data as V6ProfileRow[] | null) ?? []).filter((r) => r.v5 && String(r.v5.renewal_route ?? "") !== "");
  };
  let rows = await fetchRows();
  if (rows.length === 0 && WRITE_ROLES.has(profile.role)) {
    try { await runMemberCareGenerate(db, branchId, kstDateStr(), profile.id); } catch { /* 생성 실패가 조회를 막지 않음 */ }
    rows = await fetchRows();
  }

  const [prodR, cfgR, stateR, snapR] = await Promise.all([
    db.from("fc_products").select("*").eq("branch_id", branchId),
    db.from("fc_automation_config").select("*").eq("branch_id", branchId).maybeSingle(),
    db.from("fc_send_state").select("dedup_key,status").eq("branch_id", branchId),
    db.from("member_snapshots").select("normalized_phone,end_date").eq("branch_id", branchId).limit(5000),
  ]);
  const productByKey = new Map<string, V6ProductRow>();
  for (const p of (prodR.data as V6ProductRow[] | null) ?? []) productByKey.set(p.product_key, p);
  const cfg = (cfgR.data as V6ConfigRow | null) ?? null;
  const dryRun = cfg ? cfg.dry_run !== false : true;
  const stoppedDedup = new Set<string>();
  for (const s of (stateR.data as { dedup_key: string; status: string }[] | null) ?? []) {
    if (s.status === "stopped" || s.status === "sent") stoppedDedup.add(s.dedup_key);
  }
  const endByPhone = new Map<string, string>();
  for (const s of (snapR.data as { normalized_phone: string; end_date: string | null }[] | null) ?? []) {
    if (s.normalized_phone && s.end_date) endByPhone.set(s.normalized_phone, s.end_date);
  }

  const items = rows.map((r) => {
    const v = r.v5 as V6Blob;
    const route = String(v.renewal_route ?? "");
    const ruleId = String(v.renewal_rule_id ?? "");
    const productKey = String(v.renewal_product_key ?? "NONE");
    const couponKey = String(v.renewal_coupon_key ?? "NONE");
    const gate = String(v.renewal_gate ?? r.send_gate ?? "");
    const product = productByKey.get(productKey) ?? null;
    const { ready, warnings } = renewalDataReady(route, gate, product, couponKey, cfg);
    const endRaw = endByPhone.get(r.normalized_phone) ?? "";
    const endCompact = endRaw ? endRaw.slice(0, 10).replace(/-/g, "") : "NO_END";
    const dedupKey = `${r.normalized_phone}|${ruleId}|${endCompact}`;
    const stopped = stoppedDedup.has(dedupKey) || stoppedDedup.has(`MEMBER:${r.normalized_phone}`);
    const status = stopped ? "STOPPED" : ready && dryRun ? "DRY_RUN_READY" : ready ? "AUTO_SEND_READY" : "SETUP_REQUIRED";
    return {
      id: r.id, member_name: r.member_name, phone: r.phone, normalized_phone: r.normalized_phone,
      renewal_probability: Number(v.renewal_probability ?? 0), renewal_band: String(v.renewal_band ?? ""),
      expected_revenue: Number(v.expected_revenue ?? 0), expected_ticket: Number(v.expected_ticket ?? 0),
      days_to_expiry: v.days_to_expiry ?? null, days_expired: Number(v.days_expired ?? 0),
      vip_tier: r.vip_tier, route, rule_id: ruleId, template_key: String(v.renewal_template_key ?? ""),
      product_key: productKey, product_name: product?.name ?? "", product_months: product?.months ?? null,
      product_price: product?.price ?? null, payment_url: product?.payment_url ?? "",
      coupon_key: couponKey, gate, status, warnings, dedup_key: dedupKey, stopped,
    };
  });
  const sorted = items.sort((a, b) => (b.renewal_probability - a.renewal_probability) || (b.expected_revenue - a.expected_revenue));
  const renewal_queue = sorted.slice(0, 80);
  const autosend_queue = sorted.filter((i) => i.status === "AUTO_SEND_READY").slice(0, 80);
  const cnt = (st: string) => items.filter((i) => i.status === st).length;
  const summary = {
    total: items.length,
    high: items.filter((i) => i.renewal_band === "높음").length,
    medium: items.filter((i) => i.renewal_band === "중간").length,
    low: items.filter((i) => i.renewal_band === "낮음").length,
    dry_run_ready: cnt("DRY_RUN_READY"), auto_send_ready: cnt("AUTO_SEND_READY"),
    setup_required: cnt("SETUP_REQUIRED"), stopped: cnt("STOPPED"), dry_run: dryRun,
  };
  const config_public = cfg ? {
    branch_phone: cfg.branch_phone, free_optout: cfg.free_optout, consult_url: cfg.consult_url,
    coupon_asset_url: cfg.coupon_asset_url, payment_base_url: cfg.payment_base_url,
    dry_run: cfg.dry_run, auto_send_enabled: cfg.auto_send_enabled, webhook_configured: !!String(cfg.webhook_url ?? "").trim(),
  } : null;
  return ok(c, { summary, renewal_queue, autosend_queue, config: config_public, products: prodR.data ?? [] });
});

// V6-b) 상품 카탈로그 — 조회/저장(fc_products)
dailyReportsRoutes.get("/member-care/products", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  const branchId = c.req.query("branch_id") ?? profile.branch_id ?? "";
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data } = await db.from("fc_products").select("*").eq("branch_id", branchId).order("sort", { ascending: true });
  return ok(c, { products: data ?? [] });
});

const productSchema = z.object({
  branch_id: z.string().uuid(),
  product_key: z.string().min(1).max(20),
  name: z.string().min(1),
  months: z.number().int().nullish(),
  price: z.number().int().nullish(),
  payment_url: z.string().nullish(),
  active: z.boolean().nullish(),
  gift_key: z.string().nullish(),
  target: z.string().nullish(),
  sort: z.number().int().nullish(),
});
dailyReportsRoutes.put("/member-care/products", requireJwt, async (c) => {
  const parsed = productSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "상품 형식 오류", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, parsed.data.branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 처리할 수 없습니다", 403);
  const nowIso = new Date().toISOString();
  const row = { ...parsed.data, payment_url: parsed.data.payment_url ?? "", active: parsed.data.active ?? false, updated_at: nowIso };
  const { error } = await db.from("fc_products").upsert(row, { onConflict: "branch_id,product_key" });
  if (error) return fail(c, "DB_ERROR", `저장 실패: ${error.message}`, 500);
  return ok(c, { saved: true }, "상품을 저장했습니다");
});

// V6-c) 자동화 설정 — 조회/저장(fc_automation_config)
dailyReportsRoutes.get("/member-care/automation-config", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  const branchId = c.req.query("branch_id") ?? profile.branch_id ?? "";
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  let { data } = await db.from("fc_automation_config").select("*").eq("branch_id", branchId).maybeSingle();
  if (!data && WRITE_ROLES.has(profile.role)) {
    await db.from("fc_automation_config").upsert({ branch_id: branchId }, { onConflict: "branch_id" });
    const r = await db.from("fc_automation_config").select("*").eq("branch_id", branchId).maybeSingle();
    data = r.data;
  }
  return ok(c, { config: data ?? null });
});

const configSchema = z.object({
  branch_id: z.string().uuid(),
  branch_phone: z.string().nullish(),
  free_optout: z.string().nullish(),
  consult_url: z.string().nullish(),
  coupon_asset_url: z.string().nullish(),
  payment_base_url: z.string().nullish(),
  webhook_url: z.string().nullish(),
  kakao_channel_id: z.string().nullish(),
  dry_run: z.boolean().nullish(),
  auto_send_enabled: z.boolean().nullish(),
  high_threshold: z.number().nullish(),
  medium_threshold: z.number().nullish(),
  max_ad_contacts_30d: z.number().int().nullish(),
  min_contact_gap_days: z.number().int().nullish(),
  send_hour: z.number().int().min(0).max(23).nullish(),
  send_minute: z.number().int().min(0).max(59).nullish(),
  // 완전 자동화 그룹·채널 설정
  renewal_enabled: z.boolean().nullish(),
  onboarding_enabled: z.boolean().nullish(),
  pace_drop_enabled: z.boolean().nullish(),   // 페이스 하락(출석 급감) 자동 안부
  channel_sms: z.boolean().nullish(),
  channel_kakao: z.boolean().nullish(),
  onboarding_steps: z.array(z.number().int().min(0).max(365)).max(12).nullish(),
  message_tone: z.enum(["normal", "heart"]).nullish(),
  // 주간 안부 — 한 주 미방문 회원에게 응원 문자 1통(4개 문구 중 무작위)
  weekly_care_enabled: z.boolean().nullish(),
  weekly_care_dow: z.number().int().min(0).max(6).nullish(),
  weekly_care_gap_days: z.number().int().min(7).max(90).nullish(),
  weekly_care_max_sends: z.number().int().min(1).max(10).nullish(),
  weekly_care_coach: z.string().trim().max(20).nullish(),
});
dailyReportsRoutes.put("/member-care/automation-config", requireJwt, async (c) => {
  const parsed = configSchema.safeParse(await c.req.json().catch(() => null));
  // 어떤 필드가 왜 거부됐는지 화면에 보여준다 — '설정 형식 오류' 한 줄로는 원인 추적이 불가능했다
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return fail(c, "INVALID_REQUEST", `설정 형식 오류: ${i ? `${i.path.join(".")} — ${i.message}` : "알 수 없는 필드"}`, 400);
  }
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, parsed.data.branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 처리할 수 없습니다", 403);
  const nowIso = new Date().toISOString();
  const clean: Record<string, unknown> = { branch_id: parsed.data.branch_id, updated_by: profile.id, updated_at: nowIso };
  for (const [k, v] of Object.entries(parsed.data)) { if (k !== "branch_id" && v !== null && v !== undefined) clean[k] = v; }
  const { error } = await db.from("fc_automation_config").upsert(clean, { onConflict: "branch_id" });
  if (error) return fail(c, "DB_ERROR", `저장 실패: ${error.message}`, 500);
  return ok(c, { saved: true }, "자동화 설정을 저장했습니다");
});

// V6-d) 이벤트 수신 — 결제/상담/보류/수신거부/서비스이슈 → 후속 자동발송 중단(dedup/회원)
const eventSchema = z.object({
  branch_id: z.string().uuid(),
  member_id: z.string().nullish(),
  normalized_phone: z.string().nullish(),
  dedup_key: z.string().nullish(),
  event_type: z.string().min(1),
  detail: z.record(z.unknown()).nullish(),
});
dailyReportsRoutes.post("/member-care/renewal-events", requireJwt, async (c) => {
  const parsed = eventSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "이벤트 형식 오류", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { branch_id, member_id, normalized_phone, dedup_key, event_type, detail } = parsed.data;
  if (!canAccessBranch(profile, branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 처리할 수 없습니다", 403);
  const nowIso = new Date().toISOString();
  await db.from("fc_events").insert({ branch_id, member_id: member_id ?? null, normalized_phone: normalized_phone ?? null, dedup_key: dedup_key ?? null, event_type, detail: detail ?? {}, occurred_at: nowIso });
  if (STOP_EVENTS_V6.has(event_type)) {
    const stateRows: Record<string, unknown>[] = [];
    if (dedup_key) stateRows.push({ branch_id, dedup_key, member_id: member_id ?? null, normalized_phone: normalized_phone ?? null, status: "stopped", stop_reason: event_type, updated_at: nowIso });
    if ((event_type === "optout" || event_type === "service_issue") && normalized_phone) {
      stateRows.push({ branch_id, dedup_key: `MEMBER:${normalized_phone}`, member_id: member_id ?? null, normalized_phone, status: "stopped", stop_reason: event_type, updated_at: nowIso });
    }
    if (stateRows.length) await db.from("fc_send_state").upsert(stateRows, { onConflict: "branch_id,dedup_key" });
  }
  return ok(c, { recorded: true }, "이벤트를 기록했습니다");
});

// 1c) FC 수기 입력 — 조회/저장(fc_member_inputs). 저장 시 해당 회원 V5 즉시 재계산.
const memberInputSchema = z.object({
  branch_id: z.string().uuid(),
  normalized_phone: z.string().min(3),
  member_name: z.string().nullish(),
  satisfaction: z.number().min(0).max(5).nullish(),
  complaint: z.boolean().nullish(),
  payment_issue: z.boolean().nullish(),
  ad_consent: z.boolean().nullish(),
  opt_out: z.boolean().nullish(),
  do_not_contact: z.boolean().nullish(),
  goal: z.string().nullish(),
  barrier: z.string().nullish(),
  target_visits_per_week: z.number().nullish(),
  visits_7d: z.number().nullish(),
  visits_14d: z.number().nullish(),
  visits_30d: z.number().nullish(),
  visits_90d: z.number().nullish(),
  previous_30d_visits: z.number().nullish(),
  first_join_date: z.string().nullish(),
  membership_revenue: z.number().nullish(),
  pt_revenue: z.number().nullish(),
  other_revenue: z.number().nullish(),
  refund: z.number().nullish(),
  referral_inquiries: z.number().nullish(),
  referral_registrations: z.number().nullish(),
  referral_revenue: z.number().nullish(),
  reviews: z.number().nullish(),
  community_contribution: z.number().nullish(),
  gift_cost_365d: z.number().nullish(),
  last_vip_care_date: z.string().nullish(),
  manual_vip_tier: z.string().nullish(),
  preferred_gift_key: z.string().nullish(),
  end_reason: z.string().nullish(),
  return_interest: z.string().nullish(),
  return_declined: z.boolean().nullish(),
  recontact_date: z.string().nullish(),
  last_post_end_contact_date: z.string().nullish(),
  post_end_sales_contacts_90d: z.number().nullish(),
});

dailyReportsRoutes.get("/member-care/inputs", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  const branchId = c.req.query("branch_id") ?? profile.branch_id ?? "";
  const phone = c.req.query("phone") ?? "";
  if (!branchId || !phone) return fail(c, "INVALID_REQUEST", "branch_id·phone 필수", 400);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data } = await db.from("fc_member_inputs").select("*").eq("branch_id", branchId).eq("normalized_phone", phone).maybeSingle();
  return ok(c, { input: data ?? null });
});

dailyReportsRoutes.put("/member-care/inputs", requireJwt, async (c) => {
  const parsed = memberInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "입력 형식 오류", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { branch_id, normalized_phone } = parsed.data;
  if (!canAccessBranch(profile, branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 처리할 수 없습니다", 403);

  const nowIso = new Date().toISOString();
  const { error } = await db.from("fc_member_inputs").upsert({ ...parsed.data, updated_by: profile.id, updated_at: nowIso }, { onConflict: "branch_id,normalized_phone" });
  if (error) return fail(c, "DB_ERROR", `저장 실패: ${error.message}`, 500);

  // 저장 즉시 해당 회원 V5 재계산 → 카드 즉시 갱신
  let v5: ReturnType<typeof analyzeMemberV5> | null = null;
  const { data: snap } = await db.from("member_snapshots")
    .select("id,member_name,phone,normalized_phone,product_name,membership_type,start_date,end_date,total_sessions,used_sessions,remaining_sessions,latest_visit_date,payment_amount,status")
    .eq("branch_id", branch_id).eq("normalized_phone", normalized_phone).maybeSingle();
  if (snap) {
    v5 = analyzeMemberV5(snapshotToV5Input(snap as RawSnapshot, parsed.data as Record<string, unknown>), { settings: { today: kstDateStr() } });
    await db.from("member_care_profiles")
      .update({ v5, vip_tier: v5.vip_tier, winback_cohort: v5.winback_cohort, send_gate: v5.send_gate,
        renewal_probability: v5.renewal_probability, renewal_band: v5.renewal_band, renewal_rule_id: v5.renewal_rule_id, days_to_expiry: v5.days_to_expiry, updated_at: nowIso })
      .eq("branch_id", branch_id).eq("normalized_phone", normalized_phone);
  }
  return ok(c, { saved: true, v5 }, "회원 정보를 저장했습니다");
});

const PRIORITY_SORT: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
// 2) 대시보드 (J, lazy generate)
dailyReportsRoutes.get("/member-care/dashboard", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  const branchId = c.req.query("branch_id") ?? profile.branch_id ?? "";
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const date = c.req.query("date") ?? kstDateStr();

  const { count } = await db.from("member_care_profiles").select("id", { count: "exact", head: true }).eq("branch_id", branchId);
  if ((count ?? 0) === 0 && WRITE_ROLES.has(profile.role)) {
    try { await runMemberCareGenerate(db, branchId, date, profile.id); } catch { /* 무시: 생성 실패가 조회를 막지 않음 */ }
  }

  const [profsR, oppsR, evtsR] = await Promise.all([
    db.from("member_care_profiles").select("*").eq("branch_id", branchId),
    db.from("member_revenue_opportunities").select("*").eq("branch_id", branchId).eq("stage", "open").order("due_date", { ascending: true, nullsFirst: false }).limit(100),
    db.from("member_care_events").select("outcome,amount,event_date").eq("branch_id", branchId).gte("event_date", date),
  ]);
  const profs = (profsR.data as Record<string, unknown>[] | null) ?? [];
  const evts = (evtsR.data as { outcome: string; amount: number; event_date: string }[] | null) ?? [];

  const summary = buildCareSummary(profs.map((p) => ({ profile: p as unknown as CareProfileDraft })), evts, date);
  const buckets: Record<string, number> = {};
  for (const p of profs) { const b = String(p.care_bucket); buckets[b] = (buckets[b] ?? 0) + 1; }
  const top = profs
    .filter((p) => CARE_ACTIONABLE_BUCKETS.includes(p.care_bucket as MemberCareBucket))
    .sort((a, b) => (PRIORITY_SORT[String(a.contact_priority)] ?? 9) - (PRIORITY_SORT[String(b.contact_priority)] ?? 9)
      || Number(b.revenue_opportunity_score ?? 0) - Number(a.revenue_opportunity_score ?? 0))
    .slice(0, 50);
  const kpis = await computeMemberCareKpi(db, branchId, date.slice(0, 7));
  return ok(c, { date, summary, top_actions: top, opportunities: oppsR.data ?? [], buckets, kpis });
});

// 3) 회원 리스트 (J, 페이지네이션·필터)
dailyReportsRoutes.get("/member-care/members", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  const branchId = c.req.query("branch_id") ?? profile.branch_id ?? "";
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);

  let q = db.from("member_care_profiles").select("*", { count: "exact" }).eq("branch_id", branchId);
  const bucket = c.req.query("bucket"); if (bucket) q = q.eq("care_bucket", bucket);
  const stage = c.req.query("lifecycle_stage"); if (stage) q = q.eq("lifecycle_stage", stage);
  const pr = c.req.query("priority"); if (pr) q = q.eq("contact_priority", pr);
  const search = c.req.query("q"); if (search) q = q.ilike("member_name", `%${search}%`);
  const sort = c.req.query("sort") ?? "revenue";
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 30)));
  const page = Math.max(1, Number(c.req.query("page") ?? 1));
  const from = (page - 1) * limit;
  const ordered = sort === "expiry" ? q.order("days_until_expiry", { ascending: true, nullsFirst: false })
    : sort === "churn" ? q.order("churn_risk_score", { ascending: false })
    : q.order("revenue_opportunity_score", { ascending: false });
  const { data, count } = await ordered.range(from, from + limit - 1);
  const total = count ?? 0;
  return ok(c, { members: data ?? [], total, page, limit, next_cursor: total > from + limit ? String(page + 1) : null });
});

// 4) 회원 360 (J)
dailyReportsRoutes.get("/member-care/members/:id", requireJwt, async (c) => {
  const id = c.req.param("id");
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  const { data: prof } = await db.from("member_care_profiles").select("*").eq("id", id).maybeSingle();
  if (!prof) return fail(c, "NOT_FOUND", "대상을 찾을 수 없습니다", 404);
  const p = prof as { branch_id: string; member_snapshot_id: string | null; member_name: string };
  if (!canAccessBranch(profile, p.branch_id)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);

  const [snap, evts, opps, sales, pts, msgs] = await Promise.all([
    p.member_snapshot_id ? db.from("member_snapshots").select("*").eq("id", p.member_snapshot_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("member_care_events").select("*").eq("member_care_profile_id", id).order("event_date", { ascending: false }).limit(50),
    db.from("member_revenue_opportunities").select("*").eq("member_care_profile_id", id).order("updated_at", { ascending: false }),
    db.from("sales_entries").select("*").eq("branch_id", p.branch_id).eq("member_name", p.member_name).order("sale_date", { ascending: false }).limit(50),
    db.from("pt_passes").select("*").eq("branch_id", p.branch_id).eq("member_name", p.member_name).limit(20),
    db.from("ops_message_logs").select("*").eq("branch_id", p.branch_id).eq("recipient_name", p.member_name).order("created_at", { ascending: false }).limit(50),
  ]);
  return ok(c, {
    profile: prof, snapshot: snap.data ?? null, events: evts.data ?? [], opportunities: opps.data ?? [],
    sales: sales.data ?? [], pt_passes: pts.data ?? [], messages: msgs.data ?? [],
  });
});

// 5) 연락/상담 결과 기록 (W) — 구조화 이벤트 + (선택) 기회 won + (선택) 매출 등록
const careEventSchema = z.object({
  branch_id: z.string().uuid(),
  member_care_profile_id: z.string().uuid(),
  member_snapshot_id: z.string().uuid().nullish(),
  channel: z.string().min(1),
  event_type: z.string().min(1),
  outcome: z.string().min(1),
  amount: z.number().int().min(0).default(0),
  memo: z.string().nullish(),
  next_action_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  opportunity_id: z.string().uuid().nullish(),
  register_sale: z.boolean().default(false),
  sale_category: z.enum(["수강권", "물품", "단증"]).nullish(),
  sale_product: z.string().nullish(),
  sale_payment_method: z.enum(["현금", "카드", "계좌이체"]).default("카드"),
});
dailyReportsRoutes.post("/member-care/events", requireJwt, async (c) => {
  const parsed = careEventSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const b = parsed.data;
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, b.branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 기록할 수 없습니다", 403);

  // 프로필 확인(지점 일치)
  const { data: prof } = await db.from("member_care_profiles").select("branch_id,member_name,member_snapshot_id").eq("id", b.member_care_profile_id).maybeSingle();
  if (!prof) return fail(c, "NOT_FOUND", "회원 프로필을 찾을 수 없습니다", 404);
  const pr = prof as { branch_id: string; member_name: string; member_snapshot_id: string | null };
  if (pr.branch_id !== b.branch_id) return fail(c, "FORBIDDEN", "지점이 일치하지 않습니다", 403);

  const today = kstDateStr();
  const { data: ev, error: evErr } = await db.from("member_care_events").insert({
    branch_id: b.branch_id, member_care_profile_id: b.member_care_profile_id,
    member_snapshot_id: b.member_snapshot_id ?? pr.member_snapshot_id ?? null,
    event_date: today, channel: b.channel, event_type: b.event_type, outcome: b.outcome,
    amount: b.amount, memo: b.memo ?? null, next_action_date: b.next_action_date ?? null, created_by: profile.id,
  }).select("id").maybeSingle();
  if (evErr) return fail(c, "DB_ERROR", evErr.message, 500);
  const eventId = (ev as { id: string } | null)?.id ?? null;

  // (선택) 매출 등록 — 명시적 선택 시에만
  let saleId: string | null = null;
  if (b.register_sale && b.amount > 0 && b.sale_category) {
    const { data: sale } = await db.from("sales_entries").insert({
      branch_id: b.branch_id, sale_date: today, member_name: pr.member_name, category: b.sale_category,
      product: b.sale_product ?? b.sale_category, is_new: false, payment_method: b.sale_payment_method, amount: b.amount, created_by: profile.id,
    }).select("id").maybeSingle();
    saleId = (sale as { id: string } | null)?.id ?? null;
  }

  // (선택) 기회 단계 갱신
  let opportunityUpdated = false;
  if (b.opportunity_id) {
    const stage = CARE_PURCHASE_OUTCOMES.has(b.outcome) ? "won"
      : b.outcome === "refused" ? "lost" : b.outcome === "later" ? "snoozed" : "contacted";
    const patch: Record<string, unknown> = { stage, updated_at: new Date().toISOString() };
    if (stage === "won" && saleId) patch.converted_sale_id = saleId;
    const { error: oErr } = await db.from("member_revenue_opportunities").update(patch).eq("id", b.opportunity_id).eq("branch_id", b.branch_id);
    opportunityUpdated = !oErr;
  }
  return ok(c, { id: eventId, sale_id: saleId, opportunity_updated: opportunityUpdated }, "결과를 기록했습니다");
});

// 6) 기회 단계/금액 수정 (W)
const oppUpdateSchema = z.object({
  stage: z.enum(["open", "contacted", "proposed", "won", "lost", "snoozed"]).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  expected_amount: z.number().int().min(0).optional(),
  reason: z.string().nullish(),
  loss_reason: z.string().nullish(),
  converted_sale_id: z.string().uuid().nullish(),
});
dailyReportsRoutes.put("/member-care/opportunities/:id", requireJwt, async (c) => {
  const id = c.req.param("id");
  const parsed = oppUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "Invalid body", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data: row } = await db.from("member_revenue_opportunities").select("branch_id").eq("id", id).maybeSingle();
  if (!row) return fail(c, "NOT_FOUND", "대상을 찾을 수 없습니다", 404);
  if (!canAccessBranch(profile, (row as { branch_id: string }).branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 수정할 수 없습니다", 403);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.stage) patch.stage = parsed.data.stage;
  if (parsed.data.probability !== undefined) patch.probability = parsed.data.probability;
  if (parsed.data.due_date !== undefined) patch.due_date = parsed.data.due_date;
  if (parsed.data.expected_amount !== undefined) patch.expected_amount = parsed.data.expected_amount;
  if (parsed.data.converted_sale_id !== undefined) patch.converted_sale_id = parsed.data.converted_sale_id;
  if (parsed.data.loss_reason != null) patch.reason = parsed.data.loss_reason;
  else if (parsed.data.reason != null) patch.reason = parsed.data.reason;
  const { error } = await db.from("member_revenue_opportunities").update(patch).eq("id", id);
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { id }, "저장되었습니다");
});

// 7) 회원관리 KPI (J)
dailyReportsRoutes.get("/member-care/kpi", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  const branchId = c.req.query("branch_id") ?? profile.branch_id ?? "";
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const month = c.req.query("month") ?? kstDateStr().slice(0, 7);
  const kpi = await computeMemberCareKpi(db, branchId, month);
  return ok(c, kpi);
});

/**
 * 문자 효과 측정 — '보낸 뒤 실제로 다시 왔는가'를 출석 기록으로 대조.
 * GET /member-care/message-effect?branch_id&days
 *
 * 출석 기록이 없으면 판정 자체가 불가능하다 → attendance_count 를 함께 돌려주고
 * 화면에서 '측정 불가'와 '효과 0%'를 구분하게 한다(0% 로 오해하면 안 된다).
 */
dailyReportsRoutes.get("/member-care/message-effect", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  const branchId = c.req.query("branch_id") ?? profile.branch_id ?? "";
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const days = Math.min(Math.max(Number(c.req.query("days") ?? 90) || 90, 7), 365);

  const { data, error } = await db.rpc("ops_message_effect", { _branch_id: branchId, _days: days });
  if (error) return fail(c, "DB_ERROR", error.message, 500);

  // 이 기간에 출석 기록이 몇 건이나 있는지 (없으면 측정 불가)
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const { count } = await db.from("attendance_logs")
    .select("id", { count: "exact", head: true })
    .eq("branch_id", branchId).gte("attend_date", since);

  return ok(c, { days, rows: data ?? [], attendance_count: count ?? 0 });
});

/**
 * 첫 4주 출석 → 지금까지 유지되고 있는가 (온보딩 효과의 실측 근거).
 * GET /member-care/first4w
 * 출석 기록이 없으면 판정 불가 → attendance_count 를 함께 돌려준다.
 */
dailyReportsRoutes.get("/member-care/first4w", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  const branchId = c.req.query("branch_id") ?? profile.branch_id ?? "";
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);

  const { data, error } = await db.rpc("first4w_retention", { _branch_id: branchId });
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  const { count } = await db.from("attendance_logs")
    .select("id", { count: "exact", head: true }).eq("branch_id", branchId);

  return ok(c, { rows: data ?? [], attendance_count: count ?? 0 });
});

/**
 * 자동화 종류별 상세 — 무엇이 몇 건 나갔고, 실패는 무엇이며, 최근에 누구에게 갔는지.
 * GET /member-care/automation-detail?branch_id=&kind=onboarding|renewal|pace_drop|weekly_care&days=30
 */
dailyReportsRoutes.get("/member-care/automation-detail", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  const branchId = c.req.query("branch_id") ?? profile.branch_id ?? "";
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const kind = c.req.query("kind") ?? "";
  if (!["onboarding", "renewal", "pace_drop", "weekly_care"].includes(kind)) {
    return fail(c, "INVALID_REQUEST", "kind는 onboarding/renewal/pace_drop/weekly_care 중 하나", 400);
  }
  const days = Math.min(Math.max(Number(c.req.query("days") ?? 30) || 30, 7), 180);
  const since = new Date(Date.now() + 9 * 3600 * 1000 - days * 86400000).toISOString().slice(0, 10);

  const { data, error } = await db
    .from("automation_dispatch_log")
    .select("member_name, phone, step, channel, status, error, dispatched_on, created_at")
    .eq("branch_id", branchId).eq("kind", kind)
    .gte("dispatched_on", since)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) return fail(c, "DB_ERROR", error.message, 500);

  type Row = {
    member_name: string | null; phone: string | null; step: number | null;
    channel: string | null; status: string | null; error: string | null;
    dispatched_on: string | null; created_at: string;
  };
  const rows = (data as Row[] | null) ?? [];

  const mask = (p: string | null): string => {
    const d = (p ?? "").replace(/\D/g, "");
    return d.length < 7 ? "" : `${d.slice(0, 3)}-****-${d.slice(-4)}`;
  };

  // 요약 · 단계별 · 일자별 · 실패 사유별
  const summary = { sent: 0, failed: 0, pending: 0 };
  const byStep = new Map<number, { sent: number; failed: number }>();
  const byDay = new Map<string, { sent: number; failed: number }>();
  const errors = new Map<string, number>();
  for (const r of rows) {
    const st = r.status ?? "pending";
    if (st === "sent") summary.sent++;
    else if (st === "failed") summary.failed++;
    else summary.pending++;

    const k = r.step ?? -1;
    const s = byStep.get(k) ?? { sent: 0, failed: 0 };
    if (st === "sent") s.sent++; else if (st === "failed") s.failed++;
    byStep.set(k, s);

    const d = r.dispatched_on ?? r.created_at.slice(0, 10);
    const dd = byDay.get(d) ?? { sent: 0, failed: 0 };
    if (st === "sent") dd.sent++; else if (st === "failed") dd.failed++;
    byDay.set(d, dd);

    if (st === "failed" && r.error) {
      const key = r.error.slice(0, 80);
      errors.set(key, (errors.get(key) ?? 0) + 1);
    }
  }

  return ok(c, {
    kind, days, total: rows.length, summary,
    by_step: [...byStep.entries()].map(([step, v]) => ({ step, ...v })).sort((a, b) => a.step - b.step),
    by_day: [...byDay.entries()].map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day)),
    errors: [...errors.entries()].map(([message, count]) => ({ message, count })).sort((a, b) => b.count - a.count).slice(0, 5),
    recent: rows.slice(0, 40).map((r) => ({
      member_name: r.member_name, phone: mask(r.phone), step: r.step,
      channel: r.channel, status: r.status, error: r.error, dispatched_on: r.dispatched_on,
    })),
  });
});

/**
 * 지점 와이파이 안내 — 회원용 QR/포스터에 인쇄되는 값.
 * ⚠️ 시스템 자격증명이 아니라 벽에 붙는 안내문이다. 화면에서 게스트망 사용을 권고한다.
 */
dailyReportsRoutes.get("/branch-wifi", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  const branchId = c.req.query("branch_id") ?? profile.branch_id ?? "";
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);

  const { data, error } = await db.from("branches")
    .select("wifi_ssid, wifi_password, wifi_security, wifi_hidden")
    .eq("id", branchId).maybeSingle();
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { wifi: data ?? null });
});

const wifiSchema = z.object({
  branch_id: z.string().uuid(),
  wifi_ssid: z.string().trim().max(64).nullish(),
  wifi_password: z.string().max(128).nullish(),
  wifi_security: z.enum(["WPA", "WEP", "nopass"]).nullish(),
  wifi_hidden: z.boolean().nullish(),
});
dailyReportsRoutes.put("/branch-wifi", requireJwt, async (c) => {
  const parsed = wifiSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "입력을 확인해주세요", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, parsed.data.branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 처리할 수 없습니다", 403);

  const { branch_id, ...rest } = parsed.data;
  const { error } = await db.from("branches").update({
    wifi_ssid: rest.wifi_ssid ?? null,
    wifi_password: rest.wifi_password ?? null,
    wifi_security: rest.wifi_security ?? "WPA",
    wifi_hidden: !!rest.wifi_hidden,
  }).eq("id", branch_id);
  if (error) return fail(c, "DB_ERROR", `저장 실패: ${error.message}`, 500);
  return ok(c, { saved: true }, "와이파이 정보를 저장했습니다");
});

/**
 * 출석 현황 한눈에 — 주차별 추이 + 등급 분포 + 데이터 신뢰도.
 * GET /member-care/attendance-overview?weeks=8
 * 키오스크 설치 직후에는 기간이 짧다. first_date·day_span 을 화면에서 밝혀 오독을 막는다.
 */
dailyReportsRoutes.get("/member-care/attendance-overview", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  const branchId = c.req.query("branch_id") ?? profile.branch_id ?? "";
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const weeks = Math.min(Math.max(Number(c.req.query("weeks") ?? 8) || 8, 2), 26);

  const { data, error } = await db.rpc("ops_attendance_overview", { _branch_id: branchId, _weeks: weeks });
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { overview: data ?? null });
});

/**
 * 회원별 누적 결제금액 — VIP 점수의 '금액' 축.
 * GET /member-care/paid-totals
 * 브로제이 매출을 회원명으로 합산한 값. 매출 동기화 전이면 빈 배열이 온다(화면에서 안내).
 */
dailyReportsRoutes.get("/member-care/paid-totals", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  const branchId = c.req.query("branch_id") ?? profile.branch_id ?? "";
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);

  const { data, error } = await db.rpc("ops_member_paid_totals", { _branch_id: branchId });
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { rows: data ?? [] });
});

// 8) 본사 회원관리 예외 관제 (H)
dailyReportsRoutes.get("/hq-member-care", requireJwt, async (c) => {
  const date = c.req.query("date") ?? kstDateStr();
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !HQ_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "본사 전용입니다", 403);
  const { data: braw } = await db.from("branches").select("id,name").order("name");
  const branches = (braw as { id: string; name: string }[] | null) ?? [];

  const rows = await Promise.all(branches.map(async (b) => {
    const [{ count: total }, profsR] = await Promise.all([
      db.from("member_care_profiles").select("id", { count: "exact", head: true }).eq("branch_id", b.id),
      db.from("member_care_profiles")
        .select("care_bucket,contact_priority,churn_risk_score,expected_revenue_amount,days_until_expiry,next_contact_due_date,last_scored_at")
        .eq("branch_id", b.id).in("care_bucket", CARE_ACTIONABLE_BUCKETS),
    ]);
    const ps = (profsR.data as { care_bucket: string; contact_priority: string; churn_risk_score: number; expected_revenue_amount: number; days_until_expiry: number | null; next_contact_due_date: string | null; last_scored_at: string }[] | null) ?? [];
    let risk = 0, expected = 0, renewalD7 = 0, dormant = 0, pending = 0; let lastGen: string | null = null;
    for (const p of ps) {
      if (p.churn_risk_score >= 60) risk++;
      expected += p.expected_revenue_amount ?? 0;
      if (p.days_until_expiry != null && p.days_until_expiry >= 0 && p.days_until_expiry <= 7) renewalD7++;
      if (p.care_bucket === "winback") dormant++;
      if (p.next_contact_due_date && p.next_contact_due_date <= date) pending++;
      if (!lastGen || p.last_scored_at > lastGen) lastGen = p.last_scored_at;
    }
    return {
      branch_id: b.id, branch_name: b.name, total_members: total ?? 0,
      risk_members: risk, expected_revenue_total: expected, contact_pending_today: pending,
      renewal_d7: renewalD7, dormant_count: dormant, no_care_flag: (total ?? 0) === 0, last_generated_at: lastGen,
    };
  }));
  return ok(c, { date, branches: rows });
});

// ============================================================
// 60-Minute Branch Quest v1 — 오늘 1시간 지점관리
// 기본 루틴 퀘스트를 실제 operation_tasks 로 생성(멱등) + 콤보 보너스(reward_events 멱등).
// 완료/XP는 기존 PUT /tasks/:id + awardGameXp 그대로 사용(가짜 XP 없음).
// ============================================================
const QUEST_DEFAULTS: { key: string; category: string; title: string; description: string; action_label: string; minutes: number; xp: number }[] = [
  { key: "warmup", category: "warmup", title: "오늘 지점 상태 확인", description: "운영 HP·긴급 알림·오늘 핵심 미션을 한 번 훑어요. 오늘 흐름을 잡는 워밍업입니다.", action_label: "확인 완료", minutes: 3, xp: 5 },
  { key: "clean_open", category: "clean_open", title: "오픈·기본 청결 점검", description: "입구·데스크·바닥·샌드백 주변·보호구·화장실을 빠르게 점검해요. 깨끗한 첫인상이 회원 만족을 만듭니다.", action_label: "점검", minutes: 7, xp: 8 },
  { key: "satisfaction", category: "satisfaction", title: "회원 만족 1분 체크", description: "현장 회원 1~2명 컨디션·불편사항을 가볍게 확인해요. 작은 관심이 이탈을 막습니다.", action_label: "확인 완료", minutes: 5, xp: 8 },
  { key: "sales_review", category: "sales_report", title: "오늘 매출·상담 기록 정리", description: "오늘 결제 건을 확인하고 누락 매출을 등록해요.", action_label: "정리", minutes: 5, xp: 8 },
  { key: "finish_digest", category: "finish", title: "마무리 요약 정리", description: "오늘 처리 요약을 확인하고 단톡 보고문을 복사해요.", action_label: "요약 복사", minutes: 3, xp: 10 },
];

const questGenSchema = z.object({ branch_id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() });
dailyReportsRoutes.post("/quest/generate", requireJwt, async (c) => {
  const parsed = questGenSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !CARE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, parsed.data.branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 처리할 수 없습니다", 403);
  const date = parsed.data.date ?? kstDateStr();
  const ymd = date.replace(/-/g, "");
  const rows = QUEST_DEFAULTS.map((q) => ({
    branch_id: parsed.data.branch_id, task_date: date, category: q.category, priority: "normal", title: q.title,
    description: q.description, action_label: q.action_label, source_type: "quest", generated_key: `quest_${q.key}_${ymd}`,
    metadata: { quest: true, quest_category: q.key, est_minutes: q.minutes, xp: q.xp }, created_by: profile.id,
  }));
  const { data: existRows } = await db.from("operation_tasks").select("generated_key").eq("branch_id", parsed.data.branch_id).eq("task_date", date).like("generated_key", "quest\\_%");
  const existKeys = new Set(((existRows as { generated_key: string }[] | null) ?? []).map((r) => r.generated_key));
  await db.from("operation_tasks").upsert(rows, { onConflict: "branch_id,task_date,generated_key", ignoreDuplicates: true });
  const generated = rows.filter((r) => !existKeys.has(r.generated_key)).length;
  return ok(c, { generated, existing: rows.length - generated, total: rows.length }, "오늘 1시간 퀘스트를 준비했습니다");
});

type BonusKey = "combo3" | "flow5" | "today_clear";
const QUEST_BONUS_XP: Record<BonusKey, number> = { combo3: 5, flow5: 10, today_clear: 20 };
const QUEST_BONUS_TITLE: Record<BonusKey, string> = { combo3: "3 콤보 보너스", flow5: "플로우 보너스", today_clear: "오늘 클리어 보너스" };
const questBonusSchema = z.object({ branch_id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), bonus_key: z.enum(["combo3", "flow5", "today_clear"]) });
dailyReportsRoutes.post("/quest/bonus", requireJwt, async (c) => {
  const parsed = questBonusSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "Invalid body", 400);
  const { branch_id, bonus_key } = parsed.data;
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !CARE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 처리할 수 없습니다", 403);
  const today = parsed.data.date ?? kstDateStr();
  // 멱등: 같은 날 같은 보너스 키가 이미 있으면 재적립 안 함
  const { data: ex } = await db.from("reward_events").select("id").eq("branch_id", branch_id).eq("event_date", today)
    .eq("reward_type", "quest_bonus").eq("metadata->>bonus_key", bonus_key).maybeSingle();
  if (ex) return ok(c, { awarded: false, xp: 0 });
  const xp = QUEST_BONUS_XP[bonus_key];
  const { data: gp } = await db.from("game_profiles").select("id,total_xp").eq("branch_id", branch_id).eq("domain", "branch_ops").eq("owner_type", "branch").is("owner_id", null).maybeSingle();
  const cur = gp as { id: string; total_xp: number } | null;
  const newXp = (cur?.total_xp ?? 0) + xp;
  if (cur) await db.from("game_profiles").update({ total_xp: newXp, level: gpLevel(newXp), updated_at: new Date().toISOString() }).eq("id", cur.id);
  else await db.from("game_profiles").insert({ branch_id, domain: "branch_ops", owner_type: "branch", owner_id: null, total_xp: newXp, level: gpLevel(newXp) });
  await db.from("reward_events").insert({ branch_id, domain: "branch_ops", owner_type: "branch", owner_id: null, user_id: scoreUserId(profile), event_date: today, reward_type: "quest_bonus", title: QUEST_BONUS_TITLE[bonus_key], message: `${bonus_key} +${xp}XP`, xp_bonus: xp, metadata: { bonus_key } });
  return ok(c, { awarded: true, xp });
});

// ── 회원 케어 미션 XP 적립 ──
// 회원 케어 퀘스트(care_*)는 operation_tasks 가 없어 PUT /tasks/:id 경로를 타지 않는다.
// 그래서 코치가 가장 많이 하는 '회원 연락'이 서버 점수(reward_events)에 안 잡히던 문제를 해결.
// XP 는 클라이언트 값을 신뢰하지 않고 서버가 카테고리로 결정한다. 같은 회원·같은 날 1회만 적립(멱등).
const CARE_XP: Record<string, number> = { member_care: 10, renewal: 12, pt_upsell: 10, lead: 12, satisfaction: 8 };
const careCompleteSchema = z.object({
  branch_id: z.string().uuid(),
  quest_id: z.string().min(1).max(120),        // care_{memberId} — 멱등 키
  category: z.enum(["member_care", "renewal", "pt_upsell", "lead", "satisfaction"]),
  title: z.string().trim().max(120).nullish(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});
dailyReportsRoutes.post("/quest/care-complete", requireJwt, async (c) => {
  const parsed = careCompleteSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const { branch_id, quest_id, category } = parsed.data;
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !CARE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 처리할 수 없습니다", 403);
  const today = parsed.data.date ?? kstDateStr();

  // 하루 적립 상한 — quest_id를 임의 생성해 점수판을 부풀리는 것 방지(정상 사용은 하루 15~40건 수준)
  const { count: doneToday } = await db.from("reward_events").select("id", { count: "exact", head: true })
    .eq("branch_id", branch_id).eq("event_date", today).eq("user_id", profile.id)
    .not("metadata->>care_quest_id", "is", null);
  if ((doneToday ?? 0) >= 60) return ok(c, { awarded: false, xp: 0 });

  // 멱등: 같은 지점·같은 날·같은 케어 퀘스트는 1회만
  const { data: ex } = await db.from("reward_events").select("id")
    .eq("branch_id", branch_id).eq("event_date", today)
    .eq("reward_type", "xp").eq("metadata->>care_quest_id", quest_id).maybeSingle();
  if (ex) return ok(c, { awarded: false, xp: 0 });

  const xp = CARE_XP[category] ?? 10;
  const title = parsed.data.title?.trim() || "회원 케어";
  const { data: gp } = await db.from("game_profiles").select("id,total_xp")
    .eq("branch_id", branch_id).eq("domain", "branch_ops").eq("owner_type", "branch").is("owner_id", null).maybeSingle();
  const cur = gp as { id: string; total_xp: number } | null;
  const newXp = (cur?.total_xp ?? 0) + xp;
  if (cur) await db.from("game_profiles").update({ total_xp: newXp, level: gpLevel(newXp), updated_at: new Date().toISOString() }).eq("id", cur.id);
  else await db.from("game_profiles").insert({ branch_id, domain: "branch_ops", owner_type: "branch", owner_id: null, total_xp: newXp, level: gpLevel(newXp) });

  await db.from("reward_events").insert({
    branch_id, domain: "branch_ops", owner_type: "branch", owner_id: null,
    user_id: scoreUserId(profile), event_date: today, reward_type: "xp",
    title: "회원 케어", message: title, xp_bonus: xp,
    metadata: { care_quest_id: quest_id, category },
  });
  await db.from("activity_logs").insert({
    branch_id, domain: "branch_ops", user_id: profile.id, activity_date: today,
    activity_type: "mission_done", related_type: "member_care", related_id: null, memo: title,
  });
  return ok(c, { awarded: true, xp });
});

// ── 회원 문자 발송 (NCP SENS) — 단건·수동. 광고성은 KST 08~21시. 발송 이력 ops_message_logs. ──
const smsSendSchema = z.object({
  branch_id: z.string().uuid(),
  phone: z.string().min(8),
  content: z.string().min(1).max(2000),
  member_name: z.string().nullish(),
  category: z.enum(["info", "ad"]).default("info"),
  channel: z.enum(["sms", "kakao"]).default("sms"),
  trigger_type: z.string().nullish(),
});
dailyReportsRoutes.post("/sms/send", requireJwt, async (c) => {
  const parsed = smsSendSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const { branch_id, phone, content, member_name, category, channel, trigger_type } = parsed.data;
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 발송할 수 없습니다", 403);
  // ── 수신거부·연락금지 차단 — 자동발송(automationRunner)과 동일 기준. 사람이 누르는 발송도 예외가 아니다.
  //    category는 클라이언트 선언값이라 본문의 '(광고)'로 서버가 재분류한다.
  const nphone = phone.replace(/\D/g, "");
  const isAd = category === "ad" || content.includes("(광고)");
  const dig = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
  try {
    const [stop, inputs] = await Promise.all([
      db.from("fc_send_state").select("normalized_phone").eq("branch_id", branch_id).eq("status", "stopped").limit(5000),
      db.from("fc_member_inputs").select("normalized_phone, opt_out, do_not_contact")
        .eq("branch_id", branch_id).or("opt_out.eq.true,do_not_contact.eq.true").limit(5000),
    ]);
    const stopped = new Set(((stop.data ?? []) as { normalized_phone: string | null }[]).map((r) => dig(r.normalized_phone)).filter(Boolean));
    let optOut = false, dnc = false;
    for (const r of (inputs.data ?? []) as { normalized_phone: string | null; opt_out: boolean | null; do_not_contact: boolean | null }[]) {
      if (dig(r.normalized_phone) !== nphone) continue;
      if (r.opt_out) optOut = true;
      if (r.do_not_contact) dnc = true;
    }
    if (stopped.has(nphone) || dnc) return ok(c, { success: false, error: "연락 금지(수신거부) 회원입니다. 발송이 차단되었습니다." });
    if (isAd && optOut) return ok(c, { success: false, error: "광고 수신을 거부한 회원입니다. 광고성 문자는 발송할 수 없습니다." });
  } catch { /* 차단셋 조회 실패 시 정보성 발송은 막지 않는다 */ }
  // 광고 SMS는 무료수신거부 080 번호 필수(정보통신망법). 카카오 브랜드메시지는 채널 차원 수신동의라 080 불필요.
  if (isAd && channel !== "kakao" && !/080[-\s)]?\d{3,4}[-\s]?\d{4}/.test(content)) {
    return ok(c, { success: false, error: "광고성 문자에는 무료수신거부 080 번호가 필요합니다. 문구 끝에 '무료수신거부 080-xxx-xxxx'를 넣어주세요." });
  }
  // 발송 가능시간 — 광고 SMS 08~21시 · 카카오 08~20시(채널 규정)
  if (isAd || channel === "kakao") {
    const kstHour = new Date(Date.now() + 9 * 3600 * 1000).getUTCHours();
    const until = channel === "kakao" ? 20 : 21;
    if (kstHour < 8 || kstHour >= until) return ok(c, { success: false, error: `광고성 메시지는 오전 8시~오후 ${until - 12}시에만 발송할 수 있습니다.` });
  }
  // 카카오 = 브랜드메시지(광고 수신동의 채널친구 대상, 080 불필요), 그 외 = SMS
  const r = channel === "kakao"
    ? await sendFriendTalk(db, c.env, branch_id, phone, content, { isAd: true })
    : await sendSms(db, c.env, branch_id, phone, content);
  try {
    await db.from("ops_message_logs").insert({
      branch_id, recipient_name: member_name ?? null, phone,
      template_type: trigger_type ?? (channel === "kakao" ? "kakao_send" : "sms_send"),
      content, status: r.success ? "sent" : "failed", created_by: profile.id,
    });
  } catch { /* 로그 실패는 발송 결과를 막지 않음 */ }
  return ok(c, { success: r.success, error: r.error });
});



// ── 센터 공유 커스텀 문자 템플릿 · 기본 말투 (지점장·FC 공유) ──────────────
dailyReportsRoutes.get("/message-templates", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id");
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data: templates } = await db
    .from("ops_message_templates")
    .select("id, situation, tone, text, sort_order, created_at")
    .eq("branch_id", branchId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  const { data: settingsRow } = await db
    .from("ops_message_settings").select("default_tone").eq("branch_id", branchId).maybeSingle();
  return ok(c, { templates: templates ?? [], settings: { default_tone: settingsRow?.default_tone ?? "cs" } });
});

const tmplCreateSchema = z.object({
  branch_id: z.string().uuid(),
  situation: z.string().min(1).max(40),
  tone: z.enum(["cs", "fc", "heart"]),
  text: z.string().min(1).max(1000),
});
dailyReportsRoutes.post("/message-templates", requireJwt, async (c) => {
  const parsed = tmplCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "Invalid body", 400);
  const { branch_id, situation, tone, text } = parsed.data;
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  if (!canAccessBranch(profile, branch_id)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { count } = await db
    .from("ops_message_templates")
    .select("id", { count: "exact", head: true })
    .eq("branch_id", branch_id).eq("situation", situation).eq("tone", tone);
  if ((count ?? 0) >= 100) return fail(c, "LIMIT", "이 상황·말투 템플릿은 최대 100개까지입니다", 400);
  const { data, error } = await db
    .from("ops_message_templates")
    .insert({ branch_id, situation, tone, text, sort_order: count ?? 0, created_by: profile.id })
    .select("id, situation, tone, text, sort_order, created_at").single();
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { template: data }, "추가되었습니다");
});

dailyReportsRoutes.delete("/message-templates/:id", requireJwt, async (c) => {
  const id = c.req.param("id");
  const branchId = c.req.query("branch_id");
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { error } = await db.from("ops_message_templates").delete().eq("id", id).eq("branch_id", branchId);
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { id }, "삭제되었습니다");
});

const msgSettingsSchema = z.object({ branch_id: z.string().uuid(), default_tone: z.enum(["cs", "fc", "heart"]) });
dailyReportsRoutes.put("/message-settings", requireJwt, async (c) => {
  const parsed = msgSettingsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "Invalid body", 400);
  const { branch_id, default_tone } = parsed.data;
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  if (!canAccessBranch(profile, branch_id)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { error } = await db.from("ops_message_settings")
    .upsert({ branch_id, default_tone, updated_by: profile.id, updated_at: new Date().toISOString() }, { onConflict: "branch_id" });
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { branch_id, default_tone }, "저장되었습니다");
});

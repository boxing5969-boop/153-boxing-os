/**
 * HR 라우트 — 직원 관리 / 계약서 / 급여 명세
 * Base: /api/hr
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../lib/env";
import { fail, ok } from "../lib/responses";
import { requireJwt } from "../middleware/jwt";
import { getServiceClient } from "../lib/supabase";

export const hrRoutes = new Hono<{ Bindings: Env }>();

// ── 권한 헬퍼 ────────────────────────────────────────────────

interface CallerProfile {
  id: string;
  role: string;
  company_id: string | null;
  branch_id: string | null;
}

async function loadCaller(env: Env, userId: string): Promise<CallerProfile | null> {
  const db = getServiceClient(env);
  const { data, error } = await db
    .from("profiles")
    .select("id,role,company_id,branch_id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) {
    // 진단용: 실제 Supabase 에러를 Workers 로그에 출력
    console.error("[loadCaller] supabase error:", JSON.stringify(error), "userId:", userId);
    throw new Error(`프로필 조회 실패: ${error.message}`);
  }
  return (data as CallerProfile | null) ?? null;
}

const HQ = new Set(["super_admin", "hq_admin"]);
const MANAGER = new Set(["super_admin", "hq_admin", "branch_owner", "branch_manager"]);

function canAccessBranch(caller: CallerProfile, branchId: string): boolean {
  if (HQ.has(caller.role)) return true;
  if (MANAGER.has(caller.role) && caller.branch_id === branchId) return true;
  return false;
}

function getDb(env: Env) {
  return getServiceClient(env);
}

// ============================================================
// 직원 CRUD
// ============================================================

const staffSchema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().max(20).optional().nullable(),
  email: z.string().email().max(200).optional().nullable(),
  birth_date: z.string().optional().nullable(),
  gender: z.enum(["male", "female", "other"]).optional().nullable(),
  bank_name: z.string().max(50).optional().nullable(),
  bank_account: z.string().max(50).optional().nullable(),
  bank_holder: z.string().max(50).optional().nullable(),
  employment_type: z.enum(["regular", "parttime", "freelancer", "owner"]),
  position: z.string().max(50).optional().nullable(),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  base_salary: z.number().int().min(0).optional().nullable(),
  hourly_wage: z.number().int().min(0).optional().nullable(),
  weekly_hours: z.number().min(0).optional().nullable(),
  status: z.enum(["active", "inactive", "resigned"]).optional().default("active"),
  note: z.string().max(1000).optional().nullable(),
});

/** GET /api/hr/branches/:branchId/staff */
hrRoutes.get("/branches/:branchId/staff", requireJwt, async (c) => {
  const { branchId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);
  if (!canAccessBranch(caller, branchId)) return fail(c, "PERMISSION_DENIED", "접근 권한 없음", 403);

  const db = getDb(c.env);
  const status = c.req.query("status"); // 선택적 상태 필터

  let query = db
    .from("staff")
    .select("id,name,phone,email,employment_type,position,start_date,end_date,base_salary,hourly_wage,weekly_hours,status,created_at")
    .eq("branch_id", branchId)
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data ?? []);
});

/** GET /api/hr/staff/:staffId */
hrRoutes.get("/staff/:staffId", requireJwt, async (c) => {
  const { staffId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);

  const db = getDb(c.env);
  const { data, error } = await db
    .from("staff")
    .select("*")
    .eq("id", staffId)
    .maybeSingle();

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  if (!data) return fail(c, "NOT_FOUND", "직원을 찾을 수 없습니다", 404);

  const s = data as { branch_id: string };
  if (!canAccessBranch(caller, s.branch_id)) return fail(c, "PERMISSION_DENIED", "접근 권한 없음", 403);
  return ok(c, data);
});

/** POST /api/hr/branches/:branchId/staff */
hrRoutes.post("/branches/:branchId/staff", requireJwt, async (c) => {
  const { branchId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);
  if (!canAccessBranch(caller, branchId)) return fail(c, "PERMISSION_DENIED", "접근 권한 없음", 403);

  const parsed = staffSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);

  const db = getDb(c.env);
  const { data, error } = await db
    .from("staff")
    .insert({ ...parsed.data, branch_id: branchId })
    .select("id,name,employment_type,status")
    .single();

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data, "직원이 등록되었습니다", 201);
});

/** PUT /api/hr/staff/:staffId */
hrRoutes.put("/staff/:staffId", requireJwt, async (c) => {
  const { staffId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);

  const db = getDb(c.env);
  const { data: existing } = await db.from("staff").select("branch_id").eq("id", staffId).maybeSingle();
  if (!existing) return fail(c, "NOT_FOUND", "직원을 찾을 수 없습니다", 404);
  if (!canAccessBranch(caller, (existing as { branch_id: string }).branch_id)) return fail(c, "PERMISSION_DENIED", "접근 권한 없음", 403);

  const parsed = staffSchema.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);

  const { data, error } = await db
    .from("staff")
    .update(parsed.data)
    .eq("id", staffId)
    .select("id,name,employment_type,status")
    .single();

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data, "직원 정보가 수정되었습니다");
});

/** DELETE /api/hr/staff/:staffId  → 실제 삭제 대신 status=resigned 처리 */
hrRoutes.delete("/staff/:staffId", requireJwt, async (c) => {
  const { staffId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);

  const db = getDb(c.env);
  const { data: existing } = await db.from("staff").select("branch_id").eq("id", staffId).maybeSingle();
  if (!existing) return fail(c, "NOT_FOUND", "직원을 찾을 수 없습니다", 404);
  if (!canAccessBranch(caller, (existing as { branch_id: string }).branch_id)) return fail(c, "PERMISSION_DENIED", "접근 권한 없음", 403);

  const { error } = await db.from("staff").update({ status: "resigned", end_date: new Date().toISOString().slice(0, 10) }).eq("id", staffId);
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { id: staffId }, "퇴사 처리되었습니다");
});

// ============================================================
// 계약서 CRUD
// ============================================================

const contractSchema = z.object({
  contract_type: z.enum(["employment", "parttime", "freelance", "renewal", "other"]),
  title: z.string().min(1).max(200),
  content: z.record(z.unknown()).optional().nullable(),  // JSONB
  file_url: z.string().url().optional().nullable(),
  valid_from: z.string().optional().nullable(),
  valid_until: z.string().optional().nullable(),
  status: z.enum(["draft", "sent", "signed", "expired", "canceled"]).optional().default("draft"),
});

/** GET /api/hr/staff/:staffId/contracts */
hrRoutes.get("/staff/:staffId/contracts", requireJwt, async (c) => {
  const { staffId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);

  const db = getDb(c.env);
  const { data: s } = await db.from("staff").select("branch_id").eq("id", staffId).maybeSingle();
  if (!s) return fail(c, "NOT_FOUND", "직원을 찾을 수 없습니다", 404);
  if (!canAccessBranch(caller, (s as { branch_id: string }).branch_id)) return fail(c, "PERMISSION_DENIED", "접근 권한 없음", 403);

  const { data, error } = await db
    .from("staff_contracts")
    .select("id,contract_type,title,status,valid_from,valid_until,sent_at,signed_at,file_url,created_at")
    .eq("staff_id", staffId)
    .order("created_at", { ascending: false });

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data ?? []);
});

/** GET /api/hr/contracts/:contractId/view — 공개 조회 (JWT 불필요, 직원이 SMS 링크로 접근) */
hrRoutes.get("/contracts/:contractId/view", async (c) => {
  const { contractId } = c.req.param();
  const db = getDb(c.env);
  const { data, error } = await db
    .from("staff_contracts")
    .select("id,title,contract_type,content,valid_from,valid_until,status,sent_at,signed_at,staff:staff_id(name,position,employment_type)")
    .eq("id", contractId)
    .maybeSingle();

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  if (!data) return fail(c, "NOT_FOUND", "계약서를 찾을 수 없습니다", 404);
  // 취소/초안 상태는 공개 불가
  const row = data as { status: string };
  if (row.status === "canceled") return fail(c, "NOT_AVAILABLE", "열람할 수 없는 계약서입니다", 403);
  return ok(c, data);
});

/** GET /api/hr/contracts/:contractId */
hrRoutes.get("/contracts/:contractId", requireJwt, async (c) => {
  const { contractId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);

  const db = getDb(c.env);
  const { data, error } = await db
    .from("staff_contracts")
    .select("*, staff:staff_id(name,employment_type,branch_id)")
    .eq("id", contractId)
    .maybeSingle();

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  if (!data) return fail(c, "NOT_FOUND", "계약서를 찾을 수 없습니다", 404);

  const row = data as { branch_id: string; staff: { branch_id: string } };
  if (!canAccessBranch(caller, row.branch_id || row.staff?.branch_id)) return fail(c, "PERMISSION_DENIED", "접근 권한 없음", 403);
  return ok(c, data);
});

/** POST /api/hr/staff/:staffId/contracts */
hrRoutes.post("/staff/:staffId/contracts", requireJwt, async (c) => {
  const { staffId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);

  const db = getDb(c.env);
  const { data: s } = await db.from("staff").select("branch_id").eq("id", staffId).maybeSingle();
  if (!s) return fail(c, "NOT_FOUND", "직원을 찾을 수 없습니다", 404);
  const branchId = (s as { branch_id: string }).branch_id;
  if (!canAccessBranch(caller, branchId)) return fail(c, "PERMISSION_DENIED", "접근 권한 없음", 403);

  const parsed = contractSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);

  const { data, error } = await db
    .from("staff_contracts")
    .insert({ ...parsed.data, staff_id: staffId, branch_id: branchId, created_by: caller.id })
    .select("id,title,contract_type,status")
    .single();

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data, "계약서가 생성되었습니다", 201);
});

/** PUT /api/hr/contracts/:contractId */
hrRoutes.put("/contracts/:contractId", requireJwt, async (c) => {
  const { contractId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);

  const db = getDb(c.env);
  const { data: existing } = await db.from("staff_contracts").select("branch_id").eq("id", contractId).maybeSingle();
  if (!existing) return fail(c, "NOT_FOUND", "계약서를 찾을 수 없습니다", 404);
  if (!canAccessBranch(caller, (existing as { branch_id: string }).branch_id)) return fail(c, "PERMISSION_DENIED", "접근 권한 없음", 403);

  const parsed = contractSchema.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);

  const { data, error } = await db
    .from("staff_contracts")
    .update(parsed.data)
    .eq("id", contractId)
    .select("id,title,status")
    .single();

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data, "계약서가 수정되었습니다");
});

/** POST /api/hr/contracts/:contractId/send  — SMS로 계약서 링크 발송 */
hrRoutes.post("/contracts/:contractId/send", requireJwt, async (c) => {
  const { contractId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);

  const db = getDb(c.env);
  const { data: contract } = await db
    .from("staff_contracts")
    .select("*, staff:staff_id(name,phone,branch_id)")
    .eq("id", contractId)
    .maybeSingle();

  if (!contract) return fail(c, "NOT_FOUND", "계약서를 찾을 수 없습니다", 404);

  const row = contract as {
    id: string; branch_id: string; title: string; file_url: string | null;
    staff: { name: string; phone: string | null; branch_id: string };
  };

  if (!canAccessBranch(caller, row.branch_id)) return fail(c, "PERMISSION_DENIED", "접근 권한 없음", 403);
  if (!row.staff?.phone) return fail(c, "INVALID_REQUEST", "직원 연락처가 등록되지 않았습니다", 400);

  // 계약서 링크 생성 — PDF URL 우선, 없으면 CRM 웹 뷰 링크
  const pagesUrl = c.env.PAGES_URL ?? "https://153-boxing-os.pages.dev";
  const contractLink = row.file_url ?? `${pagesUrl}/contracts/view/${row.id}`;

  // SMS 발송
  const { sendSms } = await import("../services/smsNotifier");
  const smsContent = `[153복싱짐] ${row.staff.name}님 계약서 확인 요청\n제목: ${row.title}\n아래 링크를 클릭해 계약서를 확인해 주세요.\n${contractLink}`;
  const result = await sendSms(db, c.env, row.branch_id, row.staff.phone, smsContent);

  if (!result.success) return fail(c, "SMS_ERROR", result.error ?? "SMS 발송 실패", 500);

  // sent_at, sent_to_phone 기록
  await db.from("staff_contracts").update({
    status: "sent",
    sent_at: new Date().toISOString(),
    sent_to_phone: row.staff.phone,
  }).eq("id", contractId);

  return ok(c, { sent_to: row.staff.phone }, "계약서가 발송되었습니다");
});

// ============================================================
// 급여 명세 CRUD + 자동 계산
// ============================================================

const payrollSchema = z.object({
  year: z.number().int().min(2020).max(2099),
  month: z.number().int().min(1).max(12),
  base_pay: z.number().int().min(0),
  allowance: z.number().int().min(0).optional().default(0),
  bonus: z.number().int().min(0).optional().default(0),
  work_hours: z.number().min(0).optional().nullable(),
  work_days: z.number().int().min(0).optional().nullable(),
  memo: z.string().max(500).optional().nullable(),
  status: z.enum(["draft", "confirmed", "paid"]).optional().default("draft"),
  // 수동 입력 override (자동 계산 결과를 덮어쓸 때)
  override: z.record(z.number()).optional(),
});

/** GET /api/hr/staff/:staffId/payroll */
hrRoutes.get("/staff/:staffId/payroll", requireJwt, async (c) => {
  const { staffId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);

  const db = getDb(c.env);
  const { data: s } = await db.from("staff").select("branch_id").eq("id", staffId).maybeSingle();
  if (!s) return fail(c, "NOT_FOUND", "직원을 찾을 수 없습니다", 404);
  if (!canAccessBranch(caller, (s as { branch_id: string }).branch_id)) return fail(c, "PERMISSION_DENIED", "접근 권한 없음", 403);

  const year = c.req.query("year");
  let query = db
    .from("staff_payroll")
    .select("id,year,month,gross_pay,net_pay,total_deduction,employer_total,status,paid_at,created_at")
    .eq("staff_id", staffId)
    .order("year", { ascending: false })
    .order("month", { ascending: false });

  if (year) query = query.eq("year", parseInt(year));

  const { data, error } = await query;
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data ?? []);
});

/** GET /api/hr/branches/:branchId/payroll — 지점 전체 급여 현황 */
hrRoutes.get("/branches/:branchId/payroll", requireJwt, async (c) => {
  const { branchId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);
  if (!canAccessBranch(caller, branchId)) return fail(c, "PERMISSION_DENIED", "접근 권한 없음", 403);

  const db = getDb(c.env);
  const year = c.req.query("year") ? parseInt(c.req.query("year")!) : new Date().getFullYear();
  const month = c.req.query("month") ? parseInt(c.req.query("month")!) : undefined;

  let query = db
    .from("staff_payroll")
    .select(`
      id, year, month, gross_pay, net_pay, total_deduction, employer_total, status, paid_at,
      staff:staff_id(id, name, employment_type, position)
    `)
    .eq("branch_id", branchId)
    .eq("year", year)
    .order("month", { ascending: false });

  if (month) query = query.eq("month", month);

  const { data, error } = await query;
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data ?? []);
});

/** POST /api/hr/staff/:staffId/payroll — 급여 계산 + 저장 */
hrRoutes.post("/staff/:staffId/payroll", requireJwt, async (c) => {
  const { staffId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);

  const db = getDb(c.env);
  const { data: staffRow } = await db
    .from("staff")
    .select("branch_id,employment_type,base_salary,hourly_wage,weekly_hours")
    .eq("id", staffId)
    .maybeSingle();

  if (!staffRow) return fail(c, "NOT_FOUND", "직원을 찾을 수 없습니다", 404);
  const s = staffRow as {
    branch_id: string; employment_type: string;
    base_salary: number | null; hourly_wage: number | null; weekly_hours: number | null;
  };
  if (!canAccessBranch(caller, s.branch_id)) return fail(c, "PERMISSION_DENIED", "접근 권한 없음", 403);

  const parsed = payrollSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);

  const { year, month, base_pay, allowance, bonus, work_hours, work_days, memo, status, override } = parsed.data;

  // Supabase RPC로 급여 계산
  const { data: calc, error: calcErr } = await db.rpc("calculate_payroll", {
    _employment_type: s.employment_type,
    _base_pay: base_pay,
    _allowance: allowance ?? 0,
    _bonus: bonus ?? 0,
    _work_hours: work_hours ?? null,
    _hourly_wage: s.hourly_wage ?? null,
  });

  if (calcErr) return fail(c, "CALC_ERROR", calcErr.message, 500);

  const result = (calc as Record<string, number>) ?? {};

  // override 적용 (관리자 수동 보정)
  const merged = { ...result, ...(override ?? {}) };

  const insertData = {
    staff_id: staffId,
    branch_id: s.branch_id,
    year, month,
    base_pay,
    allowance: allowance ?? 0,
    bonus: bonus ?? 0,
    gross_pay: merged.gross_pay ?? 0,
    national_pension: merged.national_pension ?? 0,
    health_insurance: merged.health_insurance ?? 0,
    long_term_care: merged.long_term_care ?? 0,
    employment_insurance: merged.employment_insurance ?? 0,
    income_tax: merged.income_tax ?? 0,
    local_income_tax: merged.local_income_tax ?? 0,
    withholding_tax: merged.withholding_tax ?? 0,
    total_deduction: merged.total_deduction ?? 0,
    net_pay: merged.net_pay ?? 0,
    employer_pension: merged.employer_pension ?? 0,
    employer_health: merged.employer_health ?? 0,
    employer_long_term_care: merged.employer_long_term_care ?? 0,
    employer_employment: merged.employer_employment ?? 0,
    employer_accident: merged.employer_accident ?? 0,
    employer_total: merged.employer_total ?? 0,
    work_hours: work_hours ?? null,
    work_days: work_days ?? null,
    memo: memo ?? null,
    status: status ?? "draft",
    created_by: caller.id,
  };

  // upsert (같은 년/월 중복 방지)
  const { data, error } = await db
    .from("staff_payroll")
    .upsert(insertData, { onConflict: "staff_id,year,month" })
    .select("id,year,month,gross_pay,net_pay,employer_total,status")
    .single();

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { ...data, calculation: merged }, "급여 명세가 저장되었습니다", 201);
});

/** PATCH /api/hr/payroll/:payrollId/status — 상태 변경 (draft→confirmed→paid) */
hrRoutes.patch("/payroll/:payrollId/status", requireJwt, async (c) => {
  const { payrollId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);

  const body = z.object({ status: z.enum(["draft", "confirmed", "paid"]) }).safeParse(await c.req.json().catch(() => null));
  if (!body.success) return fail(c, "INVALID_REQUEST", "status 값이 올바르지 않습니다", 400);

  const db = getDb(c.env);
  const { data: existing } = await db.from("staff_payroll").select("branch_id").eq("id", payrollId).maybeSingle();
  if (!existing) return fail(c, "NOT_FOUND", "급여 명세를 찾을 수 없습니다", 404);
  if (!canAccessBranch(caller, (existing as { branch_id: string }).branch_id)) return fail(c, "PERMISSION_DENIED", "접근 권한 없음", 403);

  const updateData: Record<string, unknown> = { status: body.data.status };
  if (body.data.status === "paid") updateData.paid_at = new Date().toISOString();

  const { data, error } = await db
    .from("staff_payroll")
    .update(updateData)
    .eq("id", payrollId)
    .select("id,year,month,status,paid_at")
    .single();

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data, "상태가 변경되었습니다");
});

/** GET /api/hr/branches/:branchId/payroll/summary — 월별 인건비 요약 */
hrRoutes.get("/branches/:branchId/payroll/summary", requireJwt, async (c) => {
  const { branchId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);
  if (!canAccessBranch(caller, branchId)) return fail(c, "PERMISSION_DENIED", "접근 권한 없음", 403);

  const db = getDb(c.env);
  const year = c.req.query("year") ? parseInt(c.req.query("year")!) : new Date().getFullYear();

  // 월별 집계
  const { data, error } = await db
    .from("staff_payroll")
    .select("month,gross_pay,net_pay,total_deduction,employer_total,status")
    .eq("branch_id", branchId)
    .eq("year", year);

  if (error) return fail(c, "DB_ERROR", error.message, 500);

  // 월별 합산
  const monthly: Record<number, {
    month: number; gross_pay: number; net_pay: number;
    total_deduction: number; employer_total: number; total_cost: number; count: number;
  }> = {};

  for (const row of (data ?? []) as Array<{
    month: number; gross_pay: number; net_pay: number;
    total_deduction: number; employer_total: number; status: string;
  }>) {
    if (!monthly[row.month]) {
      monthly[row.month] = {
        month: row.month, gross_pay: 0, net_pay: 0,
        total_deduction: 0, employer_total: 0, total_cost: 0, count: 0,
      };
    }
    const m = monthly[row.month]!;
    m.gross_pay += row.gross_pay;
    m.net_pay += row.net_pay;
    m.total_deduction += row.total_deduction;
    m.employer_total += row.employer_total;
    m.total_cost = m.gross_pay + m.employer_total;
    m.count += 1;
  }

  return ok(c, {
    year,
    monthly: Object.values(monthly).sort((a, b) => a.month - b.month),
    annual_total: Object.values(monthly).reduce((acc, m) => acc + m.total_cost, 0),
  });
});

/** POST /api/hr/payroll/calculate — 계산만 (저장 없음, 미리보기용) */
hrRoutes.post("/payroll/calculate", requireJwt, async (c) => {
  const schema = z.object({
    employment_type: z.enum(["regular", "parttime", "freelancer", "owner"]),
    base_pay: z.number().int().min(0),
    allowance: z.number().int().min(0).optional().default(0),
    bonus: z.number().int().min(0).optional().default(0),
    work_hours: z.number().min(0).optional().nullable(),
    hourly_wage: z.number().int().min(0).optional().nullable(),
  });

  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);

  const db = getDb(c.env);
  const { data, error } = await db.rpc("calculate_payroll", {
    _employment_type: parsed.data.employment_type,
    _base_pay: parsed.data.base_pay,
    _allowance: parsed.data.allowance ?? 0,
    _bonus: parsed.data.bonus ?? 0,
    _work_hours: parsed.data.work_hours ?? null,
    _hourly_wage: parsed.data.hourly_wage ?? null,
  });

  if (error) return fail(c, "CALC_ERROR", error.message, 500);
  return ok(c, data as Record<string, number>);
});

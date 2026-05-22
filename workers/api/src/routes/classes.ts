/**
 * 수업 / PT 관리 라우트
 * Base: /api/classes
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../lib/env";
import { fail, ok } from "../lib/responses";
import { requireJwt } from "../middleware/jwt";
import { getServiceClient } from "../lib/supabase";

export const classesRoutes = new Hono<{ Bindings: Env }>();

function getDb(env: Env) { return getServiceClient(env); }

async function loadCaller(env: Env, userId: string) {
  const { data } = await getDb(env)
    .from("profiles")
    .select("id,role,company_id,branch_id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  return data as { id: string; role: string; company_id: string | null; branch_id: string | null } | null;
}

const HQ = new Set(["super_admin", "hq_admin"]);
function canAccess(caller: { role: string; branch_id: string | null }, branchId: string) {
  if (HQ.has(caller.role)) return true;
  return caller.branch_id === branchId;
}

// ============================================================
// 수업 (Classes)
// ============================================================

/** GET /api/classes/branches/:branchId — 수업 목록 */
classesRoutes.get("/branches/:branchId", requireJwt, async (c) => {
  const { branchId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);
  if (!canAccess(caller, branchId)) return fail(c, "PERMISSION_DENIED", "접근 권한 없음", 403);

  const { data, error } = await getDb(c.env)
    .from("classes")
    .select("id,name,class_type,capacity,duration_min,description,color,is_active,coach_id,created_at,staff(name)")
    .eq("branch_id", branchId)
    .order("created_at", { ascending: false });

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data ?? []);
});

const classSchema = z.object({
  name: z.string().min(1).max(100),
  class_type: z.enum(["group", "pt", "open"]).default("group"),
  capacity: z.number().int().min(1).max(100).default(10),
  duration_min: z.number().int().min(10).max(480).default(60),
  description: z.string().max(500).optional().nullable(),
  color: z.string().max(20).optional().default("#3b82f6"),
  coach_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().optional().default(true),
});

/** POST /api/classes/branches/:branchId — 수업 등록 */
classesRoutes.post("/branches/:branchId", requireJwt, async (c) => {
  const { branchId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);
  if (!canAccess(caller, branchId)) return fail(c, "PERMISSION_DENIED", "접근 권한 없음", 403);

  const body = classSchema.safeParse(await c.req.json());
  if (!body.success) return fail(c, "VALIDATION_ERROR", body.error.message, 400);

  const { data, error } = await getDb(c.env)
    .from("classes")
    .insert({ ...body.data, branch_id: branchId })
    .select()
    .single();

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data, undefined, 201);
});

/** PATCH /api/classes/:classId — 수업 수정 */
classesRoutes.patch("/:classId", requireJwt, async (c) => {
  const { classId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);

  const { data: cls } = await getDb(c.env)
    .from("classes").select("branch_id").eq("id", classId).single();
  if (!cls) return fail(c, "NOT_FOUND", "수업 없음", 404);
  if (!canAccess(caller, cls.branch_id)) return fail(c, "PERMISSION_DENIED", "접근 권한 없음", 403);

  const body = classSchema.partial().safeParse(await c.req.json());
  if (!body.success) return fail(c, "VALIDATION_ERROR", body.error.message, 400);

  const { data, error } = await getDb(c.env)
    .from("classes").update(body.data).eq("id", classId).select().single();
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data);
});

// ============================================================
// 수업 세션 (Class Sessions)
// ============================================================

/** GET /api/classes/sessions/branches/:branchId?date=YYYY-MM-DD&week=true */
classesRoutes.get("/sessions/branches/:branchId", requireJwt, async (c) => {
  const { branchId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);
  if (!canAccess(caller, branchId)) return fail(c, "PERMISSION_DENIED", "접근 권한 없음", 403);

  const date = c.req.query("date") ?? new Date().toISOString().slice(0, 10);
  const week = c.req.query("week") === "true";

  let query = getDb(c.env)
    .from("class_sessions")
    .select(`
      id, session_date, start_time, end_time, capacity, status, note,
      classes(id, name, class_type, color),
      staff(id, name),
      class_bookings(id, status, member_id, members(name))
    `)
    .eq("branch_id", branchId)
    .order("session_date", { ascending: true })
    .order("start_time", { ascending: true });

  if (week) {
    // 해당 주 월~일
    const d = new Date(date);
    const dayOfWeek = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    query = query
      .gte("session_date", monday.toISOString().slice(0, 10))
      .lte("session_date", sunday.toISOString().slice(0, 10));
  } else {
    query = query.eq("session_date", date);
  }

  const { data, error } = await query;
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data ?? []);
});

const sessionSchema = z.object({
  class_id: z.string().uuid(),
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
  capacity: z.number().int().min(1).optional(),
  coach_id: z.string().uuid().optional().nullable(),
  note: z.string().max(500).optional().nullable(),
});

/** POST /api/classes/sessions/branches/:branchId — 세션 생성 */
classesRoutes.post("/sessions/branches/:branchId", requireJwt, async (c) => {
  const { branchId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);
  if (!canAccess(caller, branchId)) return fail(c, "PERMISSION_DENIED", "접근 권한 없음", 403);

  const body = sessionSchema.safeParse(await c.req.json());
  if (!body.success) return fail(c, "VALIDATION_ERROR", body.error.message, 400);

  // capacity 미입력 시 수업 기본값 사용
  let capacity = body.data.capacity;
  if (!capacity) {
    const { data: cls } = await getDb(c.env)
      .from("classes").select("capacity").eq("id", body.data.class_id).single();
    capacity = cls?.capacity ?? 10;
  }

  const { data, error } = await getDb(c.env)
    .from("class_sessions")
    .insert({ ...body.data, branch_id: branchId, capacity })
    .select()
    .single();

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data, undefined, 201);
});

/** PATCH /api/classes/sessions/:sessionId/status — 세션 상태 변경 */
classesRoutes.patch("/sessions/:sessionId/status", requireJwt, async (c) => {
  const { sessionId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);

  const { status } = await c.req.json() as { status: string };
  const valid = ["scheduled", "in_progress", "completed", "canceled"];
  if (!valid.includes(status)) return fail(c, "VALIDATION_ERROR", "유효하지 않은 상태", 400);

  const { data, error } = await getDb(c.env)
    .from("class_sessions")
    .update({ status })
    .eq("id", sessionId)
    .select()
    .single();

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data);
});

// ============================================================
// 수업 예약 (Bookings)
// ============================================================

/** POST /api/classes/sessions/:sessionId/bookings — 예약 */
classesRoutes.post("/sessions/:sessionId/bookings", requireJwt, async (c) => {
  const { sessionId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);

  const { member_id } = await c.req.json() as { member_id: string };
  if (!member_id) return fail(c, "VALIDATION_ERROR", "member_id 필요", 400);

  // 정원 초과 체크
  const { data: session } = await getDb(c.env)
    .from("class_sessions")
    .select("capacity, branch_id, class_bookings(id)")
    .eq("id", sessionId)
    .single();

  if (!session) return fail(c, "NOT_FOUND", "세션 없음", 404);
  if (!canAccess(caller, session.branch_id)) return fail(c, "PERMISSION_DENIED", "접근 권한 없음", 403);

  const currentCount = (session.class_bookings as unknown[]).length;
  if (currentCount >= session.capacity) {
    return fail(c, "CAPACITY_EXCEEDED", "정원이 초과되었습니다", 409);
  }

  const { data, error } = await getDb(c.env)
    .from("class_bookings")
    .insert({ session_id: sessionId, member_id, branch_id: session.branch_id })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") return fail(c, "ALREADY_BOOKED", "이미 예약된 회원입니다", 409);
    return fail(c, "DB_ERROR", error.message, 500);
  }
  return ok(c, data, undefined, 201);
});

/** PATCH /api/classes/bookings/:bookingId/status — 출석 처리 */
classesRoutes.patch("/bookings/:bookingId/status", requireJwt, async (c) => {
  const { bookingId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);

  const { status } = await c.req.json() as { status: string };
  const valid = ["booked", "attended", "no_show", "canceled"];
  if (!valid.includes(status)) return fail(c, "VALIDATION_ERROR", "유효하지 않은 상태", 400);

  const update: Record<string, unknown> = { status };
  if (status === "attended") update.checked_in_at = new Date().toISOString();

  const { data, error } = await getDb(c.env)
    .from("class_bookings")
    .update(update)
    .eq("id", bookingId)
    .select()
    .single();

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data);
});

// ============================================================
// PT 세션
// ============================================================

/** GET /api/classes/pt/members/:memberId — 회원 PT 이력 */
classesRoutes.get("/pt/members/:memberId", requireJwt, async (c) => {
  const { memberId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);

  const { data, error } = await getDb(c.env)
    .from("pt_sessions")
    .select("id,session_date,start_time,duration_min,status,note,staff(name)")
    .eq("member_id", memberId)
    .order("session_date", { ascending: false });

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data ?? []);
});

const ptSchema = z.object({
  member_id: z.string().uuid(),
  coach_id: z.string().uuid().optional().nullable(),
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  duration_min: z.number().int().min(10).default(60),
  membership_id: z.string().uuid().optional().nullable(),
  note: z.string().max(500).optional().nullable(),
});

/** POST /api/classes/pt/branches/:branchId — PT 세션 등록 */
classesRoutes.post("/pt/branches/:branchId", requireJwt, async (c) => {
  const { branchId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);
  if (!canAccess(caller, branchId)) return fail(c, "PERMISSION_DENIED", "접근 권한 없음", 403);

  const body = ptSchema.safeParse(await c.req.json());
  if (!body.success) return fail(c, "VALIDATION_ERROR", body.error.message, 400);

  const { data, error } = await getDb(c.env)
    .from("pt_sessions")
    .insert({ ...body.data, branch_id: branchId })
    .select()
    .single();

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data, undefined, 201);
});

/** PATCH /api/classes/pt/:ptId/status — PT 세션 상태 변경 */
classesRoutes.patch("/pt/:ptId/status", requireJwt, async (c) => {
  const { ptId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);

  const { status, note } = await c.req.json() as { status: string; note?: string };
  const valid = ["scheduled", "completed", "no_show", "canceled"];
  if (!valid.includes(status)) return fail(c, "VALIDATION_ERROR", "유효하지 않은 상태", 400);

  const { data, error } = await getDb(c.env)
    .from("pt_sessions")
    .update({ status, ...(note !== undefined ? { note } : {}) })
    .eq("id", ptId)
    .select()
    .single();

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data);
});

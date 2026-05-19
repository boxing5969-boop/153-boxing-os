/**
 * 체성분 측정 + 운동 일지 라우트
 * Base: /api/fitness
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../lib/env";
import { fail, ok } from "../lib/responses";
import { requireJwt } from "../middleware/jwt";
import { getServiceClient } from "../lib/supabase";

export const fitnessRoutes = new Hono<{ Bindings: Env }>();

function getDb(env: Env) { return getServiceClient(env); }

async function loadCaller(env: Env, userId: string) {
  const { data } = await getDb(env)
    .from("profiles")
    .select("id,role,company_id,branch_id")
    .eq("auth_user_id", userId)
    .maybeSingle();
  return data as { id: string; role: string; branch_id: string | null } | null;
}

// ============================================================
// 체성분 측정 (Body Measurements)
// ============================================================

/** GET /api/fitness/members/:memberId/measurements */
fitnessRoutes.get("/members/:memberId/measurements", requireJwt, async (c) => {
  const { memberId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);

  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 100);

  const { data, error } = await getDb(c.env)
    .from("body_measurements")
    .select("id,measured_at,weight_kg,body_fat_pct,muscle_mass_kg,bmi,note,created_at")
    .eq("member_id", memberId)
    .order("measured_at", { ascending: false })
    .limit(limit);

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data ?? []);
});

const measurementSchema = z.object({
  measured_at:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(() => new Date().toISOString().slice(0, 10)),
  weight_kg:      z.number().min(20).max(300).nullable().optional(),
  body_fat_pct:   z.number().min(0).max(100).nullable().optional(),
  muscle_mass_kg: z.number().min(0).max(200).nullable().optional(),
  bmi:            z.number().min(0).max(100).nullable().optional(),
  note:           z.string().max(500).nullable().optional(),
});

/** POST /api/fitness/members/:memberId/measurements */
fitnessRoutes.post("/members/:memberId/measurements", requireJwt, async (c) => {
  const { memberId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);

  // 회원 소속 지점 확인
  const { data: member } = await getDb(c.env)
    .from("members").select("branch_id").eq("id", memberId).maybeSingle();
  if (!member) return fail(c, "NOT_FOUND", "회원 없음", 404);

  const body = measurementSchema.safeParse(await c.req.json());
  if (!body.success) return fail(c, "VALIDATION_ERROR", body.error.message, 400);

  const { data, error } = await getDb(c.env)
    .from("body_measurements")
    .insert({ ...body.data, member_id: memberId, branch_id: member.branch_id })
    .select()
    .single();

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data, 201);
});

/** DELETE /api/fitness/measurements/:id */
fitnessRoutes.delete("/measurements/:id", requireJwt, async (c) => {
  const { id } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);

  const { error } = await getDb(c.env)
    .from("body_measurements")
    .delete()
    .eq("id", id);

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { deleted: true });
});

// ============================================================
// 운동 일지 (Workout Logs)
// ============================================================

/** GET /api/fitness/members/:memberId/workouts */
fitnessRoutes.get("/members/:memberId/workouts", requireJwt, async (c) => {
  const { memberId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);

  const limit = Math.min(Number(c.req.query("limit") ?? "30"), 100);

  const { data, error } = await getDb(c.env)
    .from("workout_logs")
    .select("id,logged_date,duration_min,intensity,note,created_at,staff(name)")
    .eq("member_id", memberId)
    .order("logged_date", { ascending: false })
    .limit(limit);

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data ?? []);
});

const workoutSchema = z.object({
  logged_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(() => new Date().toISOString().slice(0, 10)),
  duration_min: z.number().int().min(1).max(480).nullable().optional(),
  intensity:    z.enum(["light", "moderate", "intense"]).nullable().optional(),
  coach_id:     z.string().uuid().nullable().optional(),
  note:         z.string().max(1000).nullable().optional(),
});

/** POST /api/fitness/members/:memberId/workouts */
fitnessRoutes.post("/members/:memberId/workouts", requireJwt, async (c) => {
  const { memberId } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);

  const { data: member } = await getDb(c.env)
    .from("members").select("branch_id").eq("id", memberId).maybeSingle();
  if (!member) return fail(c, "NOT_FOUND", "회원 없음", 404);

  const body = workoutSchema.safeParse(await c.req.json());
  if (!body.success) return fail(c, "VALIDATION_ERROR", body.error.message, 400);

  const { data, error } = await getDb(c.env)
    .from("workout_logs")
    .insert({ ...body.data, member_id: memberId, branch_id: member.branch_id })
    .select()
    .single();

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, data, 201);
});

/** DELETE /api/fitness/workouts/:id */
fitnessRoutes.delete("/workouts/:id", requireJwt, async (c) => {
  const { id } = c.req.param();
  const caller = await loadCaller(c.env, c.get("user").id);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필 없음", 403);

  const { error } = await getDb(c.env)
    .from("workout_logs")
    .delete()
    .eq("id", id);

  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { deleted: true });
});

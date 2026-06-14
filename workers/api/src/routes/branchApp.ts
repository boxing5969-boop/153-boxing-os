/**
 * 153-branch-report 전용 — 회원가입(지점 선택) + 본사 승인 플로우.
 *
 * - 가입: 누구나 신청 가능하지만 status='pending' 으로 생성 → 승인 전까지 앱/리포트 사용 불가.
 * - 승인: super_admin / hq_admin 만 status='active' 로 전환(또는 거절 시 삭제).
 * - 지점 격리: 가입 시 본인 지점(branch_id) 고정. 비-본사 계정은 자기 지점만 보임(리포트 API에서 강제).
 */
import { Hono } from "hono";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../lib/env";
import { fail, ok } from "../lib/responses";
import { requireJwt } from "../middleware/jwt";
import { getServiceClient } from "../lib/supabase";

export const branchAppRoutes = new Hono<{ Bindings: Env }>();

const HQ_ROLES = new Set(["super_admin", "hq_admin"]);

interface ProfileRow {
  id: string;
  role: string;
  status: string | null;
}

async function getProfile(db: SupabaseClient, authUserId: string): Promise<ProfileRow | null> {
  const { data } = await db
    .from("profiles")
    .select("id, role, status")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  return (data as ProfileRow | null) ?? null;
}

// ── 지점 목록 (공개 — 회원가입 지점 선택용, id·name만 노출) ──────
// branches 테이블 RLS 는 authenticated 만 SELECT 허용 → 비로그인 가입 화면은
// 직접 읽지 못한다. 서비스롤로 최소 컬럼(id, name)만 공개 반환한다.
branchAppRoutes.get("/branches", async (c) => {
  const db = getServiceClient(c.env);
  const { data } = await db.from("branches").select("id, name").order("name");
  return ok(c, { branches: (data as { id: string; name: string }[] | null) ?? [] });
});

// ── 회원가입 (공개, 승인 전까지 pending) ────────────────────
const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6, "비밀번호는 6자 이상"),
  name: z.string().min(1, "이름을 입력하세요"),
  branch_id: z.string().uuid(),
  role: z.enum(["branch_owner", "branch_manager", "coach"]).default("branch_owner"),
});

branchAppRoutes.post("/signup", async (c) => {
  const parsed = signupSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const { email, password, name, branch_id, role } = parsed.data;
  const db = getServiceClient(c.env);

  const { data: branch } = await db
    .from("branches")
    .select("id, company_id")
    .eq("id", branch_id)
    .maybeSingle();
  if (!branch) return fail(c, "INVALID_BRANCH", "지점을 찾을 수 없습니다", 400);

  // 이메일 확인 생략(본사 승인으로 게이트). 비밀번호 즉시 사용 가능하되 status=pending.
  const { data: created, error: cErr } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (cErr || !created?.user) {
    const msg = cErr?.message ?? "가입 실패";
    return fail(c, "SIGNUP_FAILED", /already|registered|exists/i.test(msg) ? "이미 가입된 이메일입니다" : msg, 400);
  }

  const { error: pErr } = await db.from("profiles").insert({
    auth_user_id: created.user.id,
    role,
    branch_id,
    company_id: (branch as { company_id: string }).company_id,
    name,
    status: "pending",
  });
  if (pErr) {
    // 프로필 생성 실패 시 고아 계정 방지
    await db.auth.admin.deleteUser(created.user.id).catch(() => undefined);
    return fail(c, "DB_ERROR", pErr.message, 500);
  }
  return ok(c, { email }, "가입 신청 완료 — 본사 승인 후 사용할 수 있습니다");
});

// ── 승인 대기 목록 (본사 전용) ──────────────────────────────
interface PendingJoin {
  id: string;
  name: string | null;
  role: string;
  created_at: string;
  branches: { name: string } | null;
}

branchAppRoutes.get("/pending", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const me = await getProfile(db, c.get("user").id);
  if (!me || !HQ_ROLES.has(me.role)) return fail(c, "FORBIDDEN", "본사 전용입니다", 403);

  const { data } = await db
    .from("profiles")
    .select("id, name, role, created_at, branches(name)")
    .eq("status", "pending")
    .order("created_at");
  const rows = ((data as PendingJoin[] | null) ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    created_at: r.created_at,
    branch_name: r.branches?.name ?? null,
  }));
  return ok(c, { pending: rows });
});

// ── 승인 / 거절 (본사 전용) ─────────────────────────────────
const decideSchema = z.object({
  profile_id: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
});

branchAppRoutes.post("/decide", requireJwt, async (c) => {
  const parsed = decideSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "Invalid body", 400);
  const db = getServiceClient(c.env);
  const me = await getProfile(db, c.get("user").id);
  if (!me || !HQ_ROLES.has(me.role)) return fail(c, "FORBIDDEN", "본사 전용입니다", 403);

  if (parsed.data.action === "approve") {
    const { error } = await db
      .from("profiles")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("id", parsed.data.profile_id);
    if (error) return fail(c, "DB_ERROR", error.message, 500);
    return ok(c, { profile_id: parsed.data.profile_id }, "승인되었습니다");
  }

  // reject → 프로필 + 계정 삭제
  const { data: prof } = await db
    .from("profiles")
    .select("auth_user_id")
    .eq("id", parsed.data.profile_id)
    .maybeSingle();
  await db.from("profiles").delete().eq("id", parsed.data.profile_id);
  const uid = (prof as { auth_user_id: string | null } | null)?.auth_user_id;
  if (uid) await db.auth.admin.deleteUser(uid).catch(() => undefined);
  return ok(c, { profile_id: parsed.data.profile_id }, "거절되었습니다");
});

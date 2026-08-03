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
import { isPremium } from "../lib/premium";

export const branchAppRoutes = new Hono<{ Bindings: Env }>();

const HQ_ROLES = new Set(["super_admin", "hq_admin"]);

interface ProfileRow {
  id: string;
  role: string;
  status: string | null;
}

// 직원(코치·지점장) 관리 대상 역할 — 본사 계정(super_admin/hq_admin)은 이 화면에서 제외/보호.
const STAFF_ROLES = ["branch_owner", "branch_manager", "coach"] as const;

interface StaffRow {
  id: string;
  auth_user_id: string | null;
  name: string | null;
  phone: string | null;
  role: string;
  status: string | null;
  branch_id: string | null;
  created_at: string;
  work_shift: string | null;
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
  phone: z.string().max(20).optional(),
  branch_id: z.string().uuid(),
  role: z.enum(["branch_owner", "branch_manager", "coach"]).default("branch_owner"),
});

branchAppRoutes.post("/signup", async (c) => {
  const parsed = signupSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const { email, password, name, phone, branch_id, role } = parsed.data;
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
    phone: phone ?? null,
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
branchAppRoutes.get("/pending", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const me = await getProfile(db, c.get("user").id);
  if (!me || !HQ_ROLES.has(me.role)) return fail(c, "FORBIDDEN", "본사 전용입니다", 403);

  // 조인 임베드에 의존하지 않는다(임베드 실패 시 조용히 빈 목록이 되던 버그 방지). 에러는 그대로 노출.
  const { data, error } = await db
    .from("profiles")
    .select("id, name, role, created_at, branch_id")
    .eq("status", "pending")
    .is("deleted_at", null)
    .order("created_at");
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  const list = (data as { id: string; name: string | null; role: string; created_at: string; branch_id: string | null }[] | null) ?? [];
  // 지점명은 별도 조회로 매핑
  const branchIds = Array.from(new Set(list.map((r) => r.branch_id).filter((v): v is string => !!v)));
  const nameMap: Record<string, string> = {};
  if (branchIds.length) {
    const { data: bs } = await db.from("branches").select("id, name").in("id", branchIds);
    for (const b of (bs as { id: string; name: string }[] | null) ?? []) nameMap[b.id] = b.name;
  }
  const rows = list.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    created_at: r.created_at,
    branch_name: r.branch_id ? (nameMap[r.branch_id] ?? null) : null,
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

  // 검수 반영(boxer): 대상 확인 없이 approve/reject 하면 임의 활성 계정을 승격·영구 삭제할 수 있다.
  // ① 가입 대기(pending)만 처리 ② 본사 계정 대상 금지 ③ 본인 대상 금지 — staff/delete 가드와 동일 수준.
  const { data: target } = await db
    .from("profiles")
    .select("id, status, role, auth_user_id")
    .eq("id", parsed.data.profile_id)
    .maybeSingle();
  if (!target) return fail(c, "NOT_FOUND", "대상 프로필이 없습니다", 404);
  if (target.status !== "pending") return fail(c, "INVALID_STATE", "가입 대기 상태가 아닙니다", 422);
  if (HQ_ROLES.has(target.role)) return fail(c, "FORBIDDEN", "본사 계정은 이 경로로 처리할 수 없습니다", 403);
  if (target.id === me.id) return fail(c, "FORBIDDEN", "본인 계정은 처리할 수 없습니다", 403);

  if (parsed.data.action === "approve") {
    const { error } = await db
      .from("profiles")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("id", parsed.data.profile_id);
    if (error) return fail(c, "DB_ERROR", error.message, 500);
    return ok(c, { profile_id: parsed.data.profile_id }, "승인되었습니다");
  }

  // reject → 프로필 + 계정 삭제 (pending 확인 완료 상태)
  await db.from("profiles").delete().eq("id", parsed.data.profile_id);
  const uid = (target as { auth_user_id: string | null } | null)?.auth_user_id;
  if (uid) {
    // ⚠️ 공유 Supabase 프로젝트 — 같은 계정이 단증앱(cert_profiles)에서도 쓰이면 auth 삭제 금지(단증앱 로그인 파괴)
    const { data: certUse } = await db.from("cert_profiles").select("user_id").eq("user_id", uid).maybeSingle();
    if (!certUse) await db.auth.admin.deleteUser(uid).catch(() => undefined);
  }
  return ok(c, { profile_id: parsed.data.profile_id }, "거절되었습니다");
});

// ── 직원(코치·지점장) 관리 — 목록 (본사 전용) ─────────────────
// "누가 쓰고 있는지" = 가입 완료된 직원 + 지점명 + 이메일(아이디) + 최근 접속시각.
branchAppRoutes.get("/staff", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const me = await getProfile(db, c.get("user").id);
  if (!me || !HQ_ROLES.has(me.role)) return fail(c, "FORBIDDEN", "본사 전용입니다", 403);

  const { data, error } = await db
    .from("profiles")
    .select("id, auth_user_id, name, phone, role, status, branch_id, created_at, work_shift")
    .in("role", STAFF_ROLES as unknown as string[])
    .is("deleted_at", null)
    .order("created_at");
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  const list = (data as StaffRow[] | null) ?? [];

  // 지점명 매핑
  const branchIds = Array.from(new Set(list.map((r) => r.branch_id).filter((v): v is string => !!v)));
  const branchMap: Record<string, string> = {};
  if (branchIds.length) {
    const { data: bs } = await db.from("branches").select("id, name").in("id", branchIds);
    for (const b of (bs as { id: string; name: string }[] | null) ?? []) branchMap[b.id] = b.name;
  }

  // 이메일(아이디)·최근 접속 매핑 — auth 관리 API (service_role)
  const authMap: Record<string, { email: string | null; last_sign_in_at: string | null }> = {};
  try {
    const { data: au } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of au?.users ?? []) authMap[u.id] = { email: u.email ?? null, last_sign_in_at: u.last_sign_in_at ?? null };
  } catch { /* auth 조회 실패 시 이메일 없이 진행 */ }

  const rows = list.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    role: r.role,
    status: r.status ?? "active",
    branch_id: r.branch_id,
    branch_name: r.branch_id ? (branchMap[r.branch_id] ?? null) : null,
    email: r.auth_user_id ? (authMap[r.auth_user_id]?.email ?? null) : null,
    last_sign_in_at: r.auth_user_id ? (authMap[r.auth_user_id]?.last_sign_in_at ?? null) : null,
    created_at: r.created_at,
    work_shift: r.work_shift ?? null,
  }));
  return ok(c, { staff: rows });
});

// ── 직원 정보·역할·상태 수정 (본사 전용) ───────────────────
const staffUpdateSchema = z.object({
  profile_id: z.string().uuid(),
  name: z.string().min(1, "이름을 입력하세요").max(40).optional(),
  phone: z.string().max(20).optional(),
  role: z.enum(["branch_owner", "branch_manager", "coach"]).optional(),
  status: z.enum(["active", "suspended"]).optional(),
  /** 근무시간대 — "morning"=새벽반(로그인 시 심플 모드), null=일반 */
  work_shift: z.enum(["morning"]).nullable().optional(),
});

branchAppRoutes.post("/staff/update", requireJwt, async (c) => {
  const parsed = staffUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const db = getServiceClient(c.env);
  const me = await getProfile(db, c.get("user").id);
  if (!me || !HQ_ROLES.has(me.role)) return fail(c, "FORBIDDEN", "본사 전용입니다", 403);

  // 대상 확인 — 본사 계정(super_admin/hq_admin)은 이 화면에서 수정 금지
  const { data: target } = await db.from("profiles").select("id, role").eq("id", parsed.data.profile_id).maybeSingle();
  if (!target) return fail(c, "NOT_FOUND", "직원을 찾을 수 없습니다", 404);
  if (HQ_ROLES.has((target as { role: string }).role)) return fail(c, "FORBIDDEN", "본사 계정은 이 화면에서 수정할 수 없습니다", 403);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: me.id };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.phone !== undefined) patch.phone = parsed.data.phone;
  if (parsed.data.role !== undefined) patch.role = parsed.data.role;
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;
  if (parsed.data.work_shift !== undefined) patch.work_shift = parsed.data.work_shift;

  const { error } = await db.from("profiles").update(patch).eq("id", parsed.data.profile_id);
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { profile_id: parsed.data.profile_id }, "저장되었습니다");
});

// ── 직원 계정 완전 삭제 (본사 전용, 되돌릴 수 없음) ──────────
const staffDeleteSchema = z.object({ profile_id: z.string().uuid() });

branchAppRoutes.post("/staff/delete", requireJwt, async (c) => {
  const parsed = staffDeleteSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "Invalid body", 400);
  const db = getServiceClient(c.env);
  const me = await getProfile(db, c.get("user").id);
  if (!me || !HQ_ROLES.has(me.role)) return fail(c, "FORBIDDEN", "본사 전용입니다", 403);

  const { data: target } = await db.from("profiles").select("id, role, auth_user_id").eq("id", parsed.data.profile_id).maybeSingle();
  if (!target) return fail(c, "NOT_FOUND", "직원을 찾을 수 없습니다", 404);
  const t = target as { id: string; role: string; auth_user_id: string | null };
  if (t.id === me.id) return fail(c, "FORBIDDEN", "본인 계정은 삭제할 수 없습니다", 403);
  if (HQ_ROLES.has(t.role)) return fail(c, "FORBIDDEN", "본사 계정은 이 화면에서 삭제할 수 없습니다", 403);

  await db.from("profiles").delete().eq("id", parsed.data.profile_id);
  if (t.auth_user_id) {
    // ⚠️ 공유 Supabase 프로젝트 — 단증앱(cert_profiles) 사용 계정이면 auth는 남긴다
    const { data: certUse } = await db.from("cert_profiles").select("user_id").eq("user_id", t.auth_user_id).maybeSingle();
    if (!certUse) await db.auth.admin.deleteUser(t.auth_user_id).catch(() => undefined);
  }
  return ok(c, { profile_id: parsed.data.profile_id }, "삭제되었습니다");
});

// ── 직원 비밀번호 재설정 (본사 전용, 임시 비번 설정 후 직원에게 전달) ──
const staffResetPwSchema = z.object({
  profile_id: z.string().uuid(),
  new_password: z.string().min(6, "비밀번호는 6자 이상"),
});

branchAppRoutes.post("/staff/reset-password", requireJwt, async (c) => {
  const parsed = staffResetPwSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const db = getServiceClient(c.env);
  const me = await getProfile(db, c.get("user").id);
  if (!me || !HQ_ROLES.has(me.role)) return fail(c, "FORBIDDEN", "본사 전용입니다", 403);

  const { data: target } = await db.from("profiles").select("id, role, auth_user_id").eq("id", parsed.data.profile_id).maybeSingle();
  if (!target) return fail(c, "NOT_FOUND", "직원을 찾을 수 없습니다", 404);
  const t = target as { id: string; role: string; auth_user_id: string | null };
  if (HQ_ROLES.has(t.role)) return fail(c, "FORBIDDEN", "본사 계정은 이 화면에서 재설정할 수 없습니다", 403);
  if (!t.auth_user_id) return fail(c, "NOT_FOUND", "계정을 찾을 수 없습니다", 404);

  const { error } = await db.auth.admin.updateUserById(t.auth_user_id, { password: parsed.data.new_password });
  if (error) return fail(c, "AUTH_ERROR", error.message, 500);
  return ok(c, { profile_id: parsed.data.profile_id }, "임시 비밀번호로 재설정되었습니다");
});

// ── 순이익 비용 설정 (월세·고정·유동 지출) — 본사/마스터 전용 ─────
interface ExpenseItem { name: string; amount: number }
const financeSchema = z.object({
  branch_id: z.string().uuid(),
  rent: z.number().int().min(0).default(0),
  fixed_expenses: z.array(z.object({ name: z.string().max(60), amount: z.number().int() })).default([]),
  variable_expenses: z.array(z.object({ name: z.string().max(60), amount: z.number().int() })).default([]),
});

branchAppRoutes.get("/finance", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id");
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const me = await getProfile(db, c.get("user").id);
  if (!me || !HQ_ROLES.has(me.role)) return fail(c, "FORBIDDEN", "본사 전용입니다", 403);
  const { data } = await db.from("branch_finance").select("rent, fixed_expenses, variable_expenses, updated_at").eq("branch_id", branchId).maybeSingle();
  const row = data as { rent: number; fixed_expenses: ExpenseItem[]; variable_expenses: ExpenseItem[]; updated_at: string } | null;
  return ok(c, {
    rent: row?.rent ?? 0,
    fixed_expenses: row?.fixed_expenses ?? [],
    variable_expenses: row?.variable_expenses ?? [],
    updated_at: row?.updated_at ?? null,
  });
});

branchAppRoutes.put("/finance", requireJwt, async (c) => {
  const parsed = financeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const db = getServiceClient(c.env);
  const me = await getProfile(db, c.get("user").id);
  if (!me || !HQ_ROLES.has(me.role)) return fail(c, "FORBIDDEN", "본사 전용입니다", 403);
  const { branch_id, rent, fixed_expenses, variable_expenses } = parsed.data;
  const { error } = await db.from("branch_finance").upsert({
    branch_id, rent, fixed_expenses, variable_expenses, updated_at: new Date().toISOString(), updated_by: me.id,
  }, { onConflict: "branch_id" });
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { saved: true }, "저장되었습니다");
});

// ══════════════════════════════════════════════════════════════
// 완전 자동화 유료 구독 (branch_subscriptions)
// ══════════════════════════════════════════════════════════════

interface ProfileBranch { id: string; role: string; branch_id: string | null; status: string | null }
// 승인·활성(active) 계정만 반환 — 미승인(pending)·정지(suspended) 계정은 회원 자동화 데이터를 못 본다.
async function getProfileBranch(db: SupabaseClient, authUserId: string): Promise<ProfileBranch | null> {
  const { data } = await db.from("profiles").select("id, role, branch_id, status").eq("auth_user_id", authUserId).maybeSingle();
  const p = (data as ProfileBranch | null) ?? null;
  if (!p || p.status !== "active") return null;
  return p;
}
function canAccess(p: ProfileBranch, branchId: string): boolean {
  return HQ_ROLES.has(p.role) || p.branch_id === branchId;
}
function maskPhone(p: string | null): string | null {
  if (!p) return p;
  const d = p.replace(/\D/g, "");
  return d.length >= 8 ? `${d.slice(0, 3)}-****-${d.slice(-4)}` : null;
}

interface SubRow { branch_id: string; status: string; valid_until: string | null; source: string; note: string | null; updated_at: string | null }

// 마스터: 전 지점 구독 현황 (지점명 + 상태)
branchAppRoutes.get("/subscriptions", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const me = await getProfile(db, c.get("user").id);
  if (!me || !HQ_ROLES.has(me.role)) return fail(c, "FORBIDDEN", "본사 전용입니다", 403);
  const { data: branches } = await db.from("branches").select("id, name").order("name");
  const { data: subs } = await db.from("branch_subscriptions").select("branch_id, status, valid_until, source, note, updated_at");
  const subMap = new Map<string, SubRow>();
  for (const s of (subs as SubRow[] | null) ?? []) subMap.set(s.branch_id, s);
  const list = ((branches as { id: string; name: string }[] | null) ?? []).map((b) => {
    const s = subMap.get(b.id);
    return { branch_id: b.id, name: b.name, status: s?.status ?? "inactive", valid_until: s?.valid_until ?? null, source: s?.source ?? "manual", note: s?.note ?? null, updated_at: s?.updated_at ?? null };
  });
  return ok(c, { subscriptions: list });
});

const subSchema = z.object({
  branch_id: z.string().uuid(),
  status: z.enum(["active", "inactive", "expired"]),
  valid_until: z.string().nullish(),   // 'YYYY-MM-DD' 또는 null=무기한
  note: z.string().max(200).nullish(),
});
// 마스터: 지점 구독 활성/해제 (수동 활성 — 결제선생 자동결제는 추후 source='payssam' 로 붙임)
branchAppRoutes.post("/subscriptions", requireJwt, async (c) => {
  const parsed = subSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  const db = getServiceClient(c.env);
  const me = await getProfile(db, c.get("user").id);
  if (!me || !HQ_ROLES.has(me.role)) return fail(c, "FORBIDDEN", "본사 전용입니다", 403);
  const { branch_id, status, valid_until, note } = parsed.data;
  const { error } = await db.from("branch_subscriptions").upsert({
    branch_id, status, valid_until: valid_until ?? null, note: note ?? null,
    source: "manual", granted_by: me.id, updated_at: new Date().toISOString(),
  }, { onConflict: "branch_id" });
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { saved: true }, status === "active" ? "구독을 활성화했습니다" : "구독을 변경했습니다");
});

// 지점: 내 지점 구독/프리미엄 여부 (설정화면 잠금 판정용)
branchAppRoutes.get("/automation/status", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id");
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const me = await getProfileBranch(db, c.get("user").id);
  if (!me || !canAccess(me, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const premium = await isPremium(db, branchId);
  const { data } = await db.from("branch_subscriptions").select("status, valid_until, source").eq("branch_id", branchId).maybeSingle();
  return ok(c, { premium, subscription: data ?? null });
});

// 지점: 자동발송 리포트 (오늘/이번주 성공·실패, 종류별, 실패 목록)
branchAppRoutes.get("/automation/report", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id");
  const period = c.req.query("period") === "week" ? "week" : "day";
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  const db = getServiceClient(c.env);
  const me = await getProfileBranch(db, c.get("user").id);
  if (!me || !canAccess(me, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const today = kstNow.toISOString().slice(0, 10);
  const from = period === "week"
    ? new Date(kstNow.getTime() - 6 * 86400000).toISOString().slice(0, 10)
    : today;
  type LogRow = { member_name: string | null; phone: string | null; kind: string; step: number; channel: string; status: string; error: string | null; dispatched_on: string; created_at: string };
  const { data } = await db.from("automation_dispatch_log")
    .select("member_name, phone, kind, step, channel, status, error, dispatched_on, created_at")
    .eq("branch_id", branchId).gte("dispatched_on", from).lte("dispatched_on", today)
    .neq("status", "pending")   // 발송 진행중(선점) 행은 리포트에서 제외 — 성공/실패만 집계
    .order("created_at", { ascending: false }).limit(500);
  const rows = (data as LogRow[] | null) ?? [];
  const sent = rows.filter((r) => r.status === "sent").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const byKind = { onboarding: rows.filter((r) => r.kind === "onboarding" && r.status === "sent").length, renewal: rows.filter((r) => r.kind === "renewal" && r.status === "sent").length };
  // 전화번호는 서버에서 마스킹해 응답(원문 미노출 — 개인정보 최소화)
  const scrub = (r: LogRow) => ({ ...r, phone: maskPhone(r.phone) });
  const failures = rows.filter((r) => r.status === "failed").slice(0, 50).map(scrub);
  return ok(c, { period, from, to: today, sent, failed, byKind, total: rows.length, recent: rows.slice(0, 100).map(scrub), failures });
});

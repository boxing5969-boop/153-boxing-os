/**
 * FC-3: 얼굴 출석 관리 API — CRM 관리자 화면(/face-attendance)이 호출.
 * 인증: requireJwt(Supabase Auth) + profiles.role 검사 — 키오스크 키 라우트(/api/face)와 완전 분리.
 * 스코프: 본사(super_admin·hq_admin)=전 지점(+?branch_id 필터),
 *         지점(branch_owner·branch_manager)=자기 지점 강제(요청값 무시).
 * 원칙: 얼굴 임베딩(생체 특징값)은 절대 응답에 싣지 않는다.
 *       access_logs 는 조회만 한다(감사 로그 — 수정·삭제 경로 없음).
 */
import { Hono } from "hono";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../lib/env";
import { fail, ok } from "../lib/responses";
import { requireJwt } from "../middleware/jwt";
import { getServiceClient } from "../lib/supabase";
import { PILOT_SOFT } from "./faceAccess";

const HQ_ROLES = new Set(["super_admin", "hq_admin"]);
const BRANCH_ROLES = new Set(["branch_owner", "branch_manager"]);
const LOG_MAX_LIMIT = 100;

interface AdminScope {
  role: string;
  /** null = 전 지점(본사). 값이 있으면 이 지점으로 강제. */
  branchId: string | null;
}

/** 프로필 로드 + 역할 검사 + 지점 스코프 결정. 권한 없으면 { error }. */
async function resolveScope(
  db: SupabaseClient,
  authUserId: string,
  requestedBranchId: string | null
): Promise<AdminScope | { error: string }> {
  const { data } = await db
    .from("profiles")
    .select("role, branch_id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  const p = data as { role: string; branch_id: string | null } | null;
  if (!p) return { error: "프로필을 찾을 수 없습니다" };
  if (HQ_ROLES.has(p.role)) return { role: p.role, branchId: requestedBranchId };
  if (BRANCH_ROLES.has(p.role)) {
    if (!p.branch_id) return { error: "지점 정보가 없는 계정입니다" };
    return { role: p.role, branchId: p.branch_id };
  }
  return { error: "얼굴 출석 관리 권한이 없습니다" };
}

export const faceAdminRoutes = new Hono<{ Bindings: Env }>();

faceAdminRoutes.use("*", requireJwt);

// 등록 현황 — face_profiles(active) 를 회원 단위로 묶어 반환 (임베딩 제외)
faceAdminRoutes.get("/enrollments", async (c) => {
  const db = getServiceClient(c.env);
  const scope = await resolveScope(db, c.get("user").id, c.req.query("branch_id") || null);
  if ("error" in scope) return fail(c, "PERMISSION_DENIED", scope.error, 403);

  const { data: fpRaw, error: fpErr } = await db
    .from("face_profiles")
    .select("member_id, consent_at, created_at")
    .eq("active", true)
    .limit(5000);
  if (fpErr) return fail(c, "DB_ERROR", "등록 현황 조회 실패", 500);
  // PostgREST 전역 상한(현재 1000행) 도달 시 무음 절단 — 화면이 과소 보고된다(검수 반영)
  if ((fpRaw || []).length >= 1000) console.error("[face-admin/enrollments] 절단 의심:", (fpRaw || []).length);

  type FpRow = { member_id: string; consent_at: string; created_at: string };
  const grouped = new Map<string, { shots: number; enrolled_at: string; consent_at: string }>();
  for (const r of (fpRaw ?? []) as FpRow[]) {
    const cur = grouped.get(r.member_id);
    if (!cur) {
      grouped.set(r.member_id, { shots: 1, enrolled_at: r.created_at, consent_at: r.consent_at });
    } else {
      cur.shots += 1;
      if (r.created_at > cur.enrolled_at) cur.enrolled_at = r.created_at;
      if (r.consent_at > cur.consent_at) cur.consent_at = r.consent_at;
    }
  }

  const ids = [...grouped.keys()];
  type MemberRow = {
    id: string;
    name: string;
    phone: string | null;
    status: string;
    branch_id: string;
    branch: { name: string } | null;
  };
  let members: MemberRow[] = [];
  const staffIds = new Set<string>();
  if (ids.length > 0) {
    const { data: mRaw, error: mErr } = await db
      .from("members")
      .select("id, name, phone, status, branch_id, branch:branches(name)")
      .in("id", ids)
      .is("deleted_at", null); // 검수 반영: /list·verify 와 대칭 — 삭제 회원이 등록 현황에 유령으로 남지 않게
    if (mErr) return fail(c, "DB_ERROR", "회원 조회 실패", 500);
    members = (mRaw ?? []) as unknown as MemberRow[];

    // FC-4: 직원 통과(access_grants staff·admin_override) 여부 표시
    const { data: gRaw } = await db
      .from("access_grants")
      .select("member_id, valid_from, valid_until")
      .in("member_id", ids)
      .eq("status", "active")
      .in("grant_type", ["staff", "admin_override"]);
    type GrantRow = { member_id: string; valid_from: string; valid_until: string | null };
    const nowMs = Date.now();
    for (const g of (gRaw ?? []) as GrantRow[]) {
      const from = new Date(g.valid_from).getTime();
      const until = g.valid_until ? new Date(g.valid_until).getTime() : Infinity;
      if (Number.isFinite(from) && from <= nowMs && until >= nowMs) staffIds.add(g.member_id);
    }
  }

  const rows = members
    .filter((m) => !scope.branchId || m.branch_id === scope.branchId)
    .map((m) => {
      const g = grouped.get(m.id);
      return {
        member_id: m.id,
        name: m.name,
        phone: m.phone,
        member_status: m.status,
        branch_id: m.branch_id,
        branch_name: m.branch?.name ?? null,
        shots: g?.shots ?? 0,
        enrolled_at: g?.enrolled_at ?? null,
        consent_at: g?.consent_at ?? null,
        is_staff: staffIds.has(m.id),
      };
    })
    .sort((a, b) => String(b.enrolled_at ?? "").localeCompare(String(a.enrolled_at ?? "")));

  return ok(c, { rows, total: rows.length });
});

// 얼굴 출입 로그 — access_logs(credential_type='face') 조회 전용
faceAdminRoutes.get("/logs", async (c) => {
  const db = getServiceClient(c.env);
  const scope = await resolveScope(db, c.get("user").id, c.req.query("branch_id") || null);
  if ("error" in scope) return fail(c, "PERMISSION_DENIED", scope.error, 403);

  const limit = Math.min(
    Math.max(parseInt(c.req.query("limit") || "20", 10) || 20, 1),
    LOG_MAX_LIMIT
  );
  const offset = Math.max(parseInt(c.req.query("offset") || "0", 10) || 0, 0);
  const reason = c.req.query("reason") || "";
  const from = c.req.query("from") || "";
  const to = c.req.query("to") || "";

  let q = db
    .from("access_logs")
    .select(
      "id, branch_id, member_id, result, denied_reason, occurred_at, member:members(name), branch:branches(name)",
      { count: "exact" }
    )
    .eq("credential_type", "face")
    .order("occurred_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (scope.branchId) q = q.eq("branch_id", scope.branchId);
  if (reason === "ok") q = q.is("denied_reason", null);
  else if (reason) q = q.eq("denied_reason", reason);
  if (from) q = q.gte("occurred_at", from);
  if (to) q = q.lte("occurred_at", to);

  const { data, error, count } = await q;
  if (error) return fail(c, "DB_ERROR", "출입 로그 조회 실패", 500);

  type LogRow = {
    id: string;
    branch_id: string;
    member_id: string | null;
    result: string;
    denied_reason: string | null;
    occurred_at: string;
    member: { name: string } | null;
    branch: { name: string } | null;
  };
  const rows = ((data ?? []) as unknown as LogRow[]).map((r) => ({
    id: r.id,
    branch_id: r.branch_id,
    branch_name: r.branch?.name ?? null,
    member_id: r.member_id,
    member_name: r.member?.name ?? null,
    result: r.result,
    denied_reason: r.denied_reason,
    occurred_at: r.occurred_at,
  }));

  return ok(c, { rows, total: count ?? 0, pilot_soft: PILOT_SOFT });
});

// FC-4: 직원 통과 지정/해제 — verify 가 이용권보다 먼저 보는 access_grants(staff)를 관리.
// 지정=grant 1건 생성(무기한), 해제=활성 staff grant 전부 revoked. 즉시 가역.
const staffGrantSchema = z.object({ member_id: z.string().uuid(), enable: z.boolean() });

faceAdminRoutes.post("/staff-grant", async (c) => {
  const parsed = staffGrantSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "member_id(uuid)·enable(boolean)이 필요합니다", 400);

  const db = getServiceClient(c.env);
  const scope = await resolveScope(db, c.get("user").id, null);
  if ("error" in scope) return fail(c, "PERMISSION_DENIED", scope.error, 403);

  const { data: mRaw } = await db
    .from("members")
    .select("id, name, branch_id")
    .eq("id", parsed.data.member_id)
    .maybeSingle();
  const member = mRaw as { id: string; name: string; branch_id: string } | null;
  if (!member) return fail(c, "NOT_FOUND", "회원을 찾을 수 없습니다", 404);
  if (scope.branchId && member.branch_id !== scope.branchId) {
    return fail(c, "PERMISSION_DENIED", "다른 지점 회원의 권한은 변경할 수 없습니다", 403);
  }

  if (parsed.data.enable) {
    const { data: existing } = await db
      .from("access_grants")
      .select("id")
      .eq("member_id", member.id)
      .eq("grant_type", "staff")
      .eq("status", "active")
      .limit(1);
    if ((existing ?? []).length > 0) {
      return ok(c, { member_id: member.id, is_staff: true }, "이미 직원 통과가 설정되어 있습니다");
    }
    const { error } = await db.from("access_grants").insert({
      member_id: member.id,
      branch_id: member.branch_id,
      grant_type: "staff",
      valid_from: new Date().toISOString(),
      status: "active",
      reason: "CRM 얼굴 출석 — 직원 통과 설정",
    });
    if (error) return fail(c, "DB_ERROR", "직원 통과 설정 실패", 500);
    return ok(c, { member_id: member.id, is_staff: true }, `${member.name}님을 직원 통과로 설정했습니다`);
  }

  const { error } = await db
    .from("access_grants")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("member_id", member.id)
    .in("grant_type", ["staff", "admin_override"]) // 검수 반영: is_staff 판정과 대칭 — admin_override도 해제
    .eq("status", "active");
  if (error) return fail(c, "DB_ERROR", "직원 통과 해제 실패", 500);
  return ok(c, { member_id: member.id, is_staff: false }, `${member.name}님의 직원 통과를 해제했습니다`);
});

const deactivateSchema = z.object({ member_id: z.string().uuid() });

// 등록 해제 — face_profiles active=false + face_recognition 동의 철회 기록.
// 임베딩 행만 비활성화하며 access_logs 는 건드리지 않는다.
faceAdminRoutes.post("/deactivate", async (c) => {
  const parsed = deactivateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "member_id(uuid)가 필요합니다", 400);

  const db = getServiceClient(c.env);
  const scope = await resolveScope(db, c.get("user").id, null);
  if ("error" in scope) return fail(c, "PERMISSION_DENIED", scope.error, 403);

  const { data: mRaw } = await db
    .from("members")
    .select("id, name, branch_id")
    .eq("id", parsed.data.member_id)
    .maybeSingle();
  const member = mRaw as { id: string; name: string; branch_id: string } | null;
  if (!member) return fail(c, "NOT_FOUND", "회원을 찾을 수 없습니다", 404);
  if (scope.branchId && member.branch_id !== scope.branchId) {
    return fail(c, "PERMISSION_DENIED", "다른 지점 회원의 등록은 해제할 수 없습니다", 403);
  }

  const { data: updated, error: upErr } = await db
    .from("face_profiles")
    .update({ active: false })
    .eq("member_id", member.id)
    .eq("active", true)
    .select("id");
  if (upErr) return fail(c, "DB_ERROR", "등록 해제 실패", 500);
  const deactivated = (updated ?? []).length;
  if (deactivated === 0) return fail(c, "NOT_FOUND", "활성 상태의 얼굴 등록이 없습니다", 404);

  // 동의 철회 기록 — 활성 face_recognition 동의에 revoked_at 세팅
  const { data: revoked, error: cErr } = await db
    .from("consent_records")
    .update({ revoked_at: new Date().toISOString() })
    .eq("member_id", member.id)
    .eq("consent_type", "face_recognition")
    .is("revoked_at", null)
    .select("id");
  if (cErr) return fail(c, "DB_ERROR", "동의 철회 기록 실패(등록은 해제됨)", 500);

  return ok(
    c,
    {
      member_id: member.id,
      deactivated,
      consents_revoked: (revoked ?? []).length,
    },
    `${member.name} 회원의 얼굴 등록을 해제했습니다`
  );
});

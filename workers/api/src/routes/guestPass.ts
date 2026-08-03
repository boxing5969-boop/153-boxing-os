/**
 * 게스트 초대권 (/api/guest-pass)
 *
 * - 공개: GET /p/:slug — 회원이 받은 링크를 열면 쿠폰 정보를 준다(내부 ID 비노출).
 * - 직원: 목록 · 수동 발급 · 사용 처리 · 취소.
 *
 * ⚠️ '사용'은 반드시 서버에서 상태를 바꾼다. 화면에서만 처리하면 같은 링크가 여러 번 쓰인다.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../lib/env";
import { getServiceClient } from "../lib/supabase";
import { requireJwt } from "../middleware/jwt";
import { fail, ok } from "../lib/responses";
import { issueGuestPass, PASS_VALUE_WON } from "../services/guestPass";

export const guestPassRoutes = new Hono<{ Bindings: Env }>();

interface Profile { id: string; role: string; branch_id: string | null }
const HQ_ROLES = new Set(["super_admin", "hq_admin"]);
const WRITE_ROLES = new Set(["super_admin", "hq_admin", "branch_owner", "branch_manager", "coach"]);
async function getProfile(db: ReturnType<typeof getServiceClient>, userId: string): Promise<Profile | null> {
  const { data } = await db.from("profiles").select("id, role, branch_id").eq("auth_user_id", userId).maybeSingle();
  return (data as Profile | null) ?? null;
}
function canAccessBranch(p: Profile, branchId: string): boolean {
  return HQ_ROLES.has(p.role) || p.branch_id === branchId;
}
function maskPhone(p: string | null | undefined): string {
  const d = (p ?? "").replace(/\D/g, "");
  if (d.length < 7) return "";
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
}

/** GET /api/guest-pass/p/:slug — 공개. 쿠폰 표시에 필요한 값만 */
guestPassRoutes.get("/p/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!slug || slug.length > 64) return fail(c, "NOT_FOUND", "잘못된 주소입니다", 404);
  const db = getServiceClient(c.env);
  const { data } = await db.from("guest_passes")
    .select("slug, issuer_name, value_won, valid_until, status, used_at, branches(name, phone)")
    .eq("slug", slug).maybeSingle();
  const row = data as
    | { slug: string; issuer_name: string | null; value_won: number; valid_until: string | null; status: string; used_at: string | null;
        branches: { name: string; phone: string | null } | { name: string; phone: string | null }[] | null }
    | null;
  if (!row) return fail(c, "NOT_FOUND", "없는 초대권입니다", 404);
  const b = Array.isArray(row.branches) ? row.branches[0] : row.branches;
  return ok(c, {
    pass: {
      slug: row.slug,
      issuer_name: row.issuer_name,
      value_won: row.value_won,
      valid_until: row.valid_until,
      status: row.status,
      used_at: row.used_at,
      branch_name: b?.name ?? "153복싱짐",
      branch_phone: b?.phone ?? null,
    },
  });
});

/** GET /api/guest-pass/list?branch_id=&status= — 직원 */
guestPassRoutes.get("/list", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  const branchId = c.req.query("branch_id") ?? profile.branch_id ?? "";
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const status = c.req.query("status") ?? "";

  let q = db.from("guest_passes")
    .select("id, slug, issuer_name, issuer_phone, source, value_won, valid_until, status, used_at, guest_name, created_at")
    .eq("branch_id", branchId).order("created_at", { ascending: false }).limit(300);
  if (status && status !== "all") q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  type Row = { issuer_phone: string | null } & Record<string, unknown>;
  const rows = ((data as Row[] | null) ?? []).map((r) => ({ ...r, issuer_phone: maskPhone(r.issuer_phone) }));
  return ok(c, { rows });
});

/** POST /api/guest-pass/issue — 직원이 직접 발급 */
const issueSchema = z.object({
  branch_id: z.string().uuid(),
  issuer_name: z.string().trim().max(40).nullish(),
  issuer_phone: z.string().trim().max(40).nullish(),
});
guestPassRoutes.post("/issue", requireJwt, async (c) => {
  const parsed = issueSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "입력을 확인해주세요", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, parsed.data.branch_id)) return fail(c, "FORBIDDEN", "다른 지점은 처리할 수 없습니다", 403);

  const pass = await issueGuestPass(db, {
    branchId: parsed.data.branch_id,
    name: parsed.data.issuer_name ?? null,
    phone: parsed.data.issuer_phone ?? null,
    source: "manual",
  });
  if (!pass) return fail(c, "DB_ERROR", "발급에 실패했습니다", 500);
  return ok(c, { pass });
});

/** POST /api/guest-pass/:id/use — 데스크에서 사용 처리 */
const useSchema = z.object({ guest_name: z.string().trim().max(40).nullish(), note: z.string().trim().max(200).nullish() });
guestPassRoutes.post("/:id/use", requireJwt, async (c) => {
  const id = c.req.param("id");
  const parsed = useSchema.safeParse(await c.req.json().catch(() => ({})));
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);

  const { data: cur } = await db.from("guest_passes").select("branch_id, status").eq("id", id).maybeSingle();
  const row = cur as { branch_id: string; status: string } | null;
  if (!row) return fail(c, "NOT_FOUND", "없는 초대권입니다", 404);
  if (!canAccessBranch(profile, row.branch_id)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (row.status !== "issued") return fail(c, "INVALID_REQUEST", row.status === "used" ? "이미 사용된 초대권입니다" : "사용할 수 없는 초대권입니다", 400);

  // status 조건을 where 에 함께 걸어 동시 처리 시 이중 사용을 막는다.
  const { data: upd, error } = await db.from("guest_passes")
    .update({
      status: "used", used_at: new Date().toISOString(), used_by: profile.id,
      guest_name: parsed.success ? (parsed.data.guest_name ?? null) : null,
      used_note: parsed.success ? (parsed.data.note ?? null) : null,
    })
    .eq("id", id).eq("status", "issued").select("id").maybeSingle();
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  if (!upd) return fail(c, "INVALID_STATE", "이미 사용되었거나 취소된 초대권입니다", 400);
  if (!upd) return fail(c, "INVALID_REQUEST", "이미 사용된 초대권입니다", 400);
  return ok(c, { used: true });
});

/** POST /api/guest-pass/:id/void — 취소(잘못 발급) */
guestPassRoutes.post("/:id/void", requireJwt, async (c) => {
  const id = c.req.param("id");
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data: cur } = await db.from("guest_passes").select("branch_id").eq("id", id).maybeSingle();
  const row = cur as { branch_id: string } | null;
  if (!row) return fail(c, "NOT_FOUND", "없는 초대권입니다", 404);
  if (!canAccessBranch(profile, row.branch_id)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data: upd, error } = await db.from("guest_passes").update({ status: "void" }).eq("id", id).eq("status", "issued").select("id").maybeSingle();
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { voided: true, value_won: PASS_VALUE_WON });
});

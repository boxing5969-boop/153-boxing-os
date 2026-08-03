/**
 * 결제확인서 (/api/cert)
 *
 * - 직원(requireJwt): POST /(발급) · GET /list · PUT /:id/revoke — 지점 스코프.
 * - 공개(로그인 없음): GET /pub/:slug — 회원이 문자 링크로 열람(무추측 슬러그, 회수 시 404).
 *   공개 응답엔 연락처를 포함하지 않는다(확인서 표기 항목만).
 */
import { Hono } from "hono";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../lib/env";
import { fail, ok } from "../lib/responses";
import { requireJwt } from "../middleware/jwt";
import { getServiceClient } from "../lib/supabase";

export const certRoutes = new Hono<{ Bindings: Env }>();

const HQ_ROLES = new Set(["super_admin", "hq_admin"]);
const WRITE_ROLES = new Set(["super_admin", "hq_admin", "branch_owner", "branch_manager"]);

interface ProfileRow { id: string; role: string; branch_id: string | null }

async function getProfile(db: SupabaseClient, authUserId: string): Promise<ProfileRow | null> {
  const { data } = await db
    .from("profiles").select("id, role, branch_id, status")
    .eq("auth_user_id", authUserId).maybeSingle();
  const p = data as (ProfileRow & { status?: string }) | null;
  return p && p.status === "active" ? p : null;
}
const canAccessBranch = (p: ProfileRow, b: string) => HQ_ROLES.has(p.role) || p.branch_id === b;

function randSlug(): string {
  const b = new Uint8Array(6); crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
function kstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

const issueSchema = z.object({
  branch_id: z.string().uuid(),
  member_name: z.string().trim().min(1).max(40),
  member_phone: z.string().trim().max(20).nullable().optional(),
  product_name: z.string().trim().min(1).max(80),
  amount: z.number().int().min(0).max(100000000),
  payment_method: z.string().trim().max(20).nullable().optional(),
  paid_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  purpose: z.string().trim().max(60).nullable().optional(),
});

/** POST /api/cert — 발급 → 슬러그 반환 */
certRoutes.post("/", requireJwt, async (c) => {
  const parsed = issueSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "입력을 확인해주세요", 400);
  const body = parsed.data;
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, body.branch_id)) return fail(c, "FORBIDDEN", "다른 지점입니다", 403);

  const slug = randSlug();
  const certNo = `153-${kstToday().replace(/-/g, "")}-${slug.slice(0, 6).toUpperCase()}`;
  const { data, error } = await db.from("payment_certificates").insert({
    branch_id: body.branch_id,
    slug,
    cert_no: certNo,
    member_name: body.member_name,
    member_phone: (body.member_phone ?? "").replace(/\D/g, "") || null,
    product_name: body.product_name,
    amount: body.amount,
    payment_method: body.payment_method ?? null,
    paid_date: body.paid_date ?? null,
    period_start: body.period_start ?? null,
    period_end: body.period_end ?? null,
    purpose: body.purpose ?? null,
    issued_by: profile.id,
  }).select("id, slug, cert_no").single();
  if (error || !data) return fail(c, "INTERNAL_ERROR", "발급에 실패했습니다", 500);
  return ok(c, data as { id: string; slug: string; cert_no: string });
});

/** GET /api/cert/list?branch_id — 최근 발급 목록 */
certRoutes.get("/list", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id") ?? "";
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필요", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "다른 지점입니다", 403);

  const { data, error } = await db
    .from("payment_certificates")
    .select("id, slug, cert_no, member_name, member_phone, product_name, amount, paid_date, revoked_at, created_at")
    .eq("branch_id", branchId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return fail(c, "INTERNAL_ERROR", "불러오기 실패", 500);
  return ok(c, { items: data ?? [] });
});

/** PUT /api/cert/:id/revoke — 링크 회수(공개 페이지 404) */
certRoutes.put("/:id/revoke", requireJwt, async (c) => {
  const id = c.req.param("id");
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !WRITE_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const { data: cur } = await db.from("payment_certificates").select("branch_id").eq("id", id).maybeSingle();
  const row = cur as { branch_id: string } | null;
  if (!row) return fail(c, "NOT_FOUND", "없는 확인서입니다", 404);
  if (!canAccessBranch(profile, row.branch_id)) return fail(c, "FORBIDDEN", "다른 지점입니다", 403);
  const { error } = await db.from("payment_certificates").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  if (error) return fail(c, "INTERNAL_ERROR", "회수 실패", 500);
  return ok(c, { revoked: true });
});

/** GET /api/cert/pub/:slug — 공개. 확인서 표기 항목만(연락처 미포함). */
certRoutes.get("/pub/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!slug || slug.length > 32) return fail(c, "NOT_FOUND", "잘못된 주소입니다", 404);
  const db = getServiceClient(c.env);
  const { data } = await db
    .from("payment_certificates")
    .select("cert_no, member_name, product_name, amount, payment_method, paid_date, period_start, period_end, purpose, created_at, revoked_at, branches(name, phone, biz_number)")
    .eq("slug", slug)
    .maybeSingle();
  const row = data as
    | {
        cert_no: string; member_name: string; product_name: string; amount: number;
        payment_method: string | null; paid_date: string | null; period_start: string | null; period_end: string | null;
        purpose: string | null; created_at: string; revoked_at: string | null;
        branches:
          | { name: string; phone: string | null; biz_number: string | null }
          | { name: string; phone: string | null; biz_number: string | null }[]
          | null;
      }
    | null;
  if (!row || row.revoked_at) return fail(c, "NOT_FOUND", "만료되었거나 없는 확인서입니다", 404);
  const b = Array.isArray(row.branches) ? row.branches[0] : row.branches;
  return ok(c, {
    cert_no: row.cert_no,
    member_name: row.member_name,
    product_name: row.product_name,
    amount: row.amount,
    payment_method: row.payment_method,
    paid_date: row.paid_date,
    period_start: row.period_start,
    period_end: row.period_end,
    purpose: row.purpose,
    issued_at: row.created_at,
    branch_name: b?.name ?? "153복싱짐",
    branch_phone: b?.phone ?? null,
    branch_biz_no: b?.biz_number ?? null,
  });
});

/**
 * 회원 의견·칭찬 수집 (/api/feedback)
 *
 * - 공개(로그인 없음): 키오스크 QR → /f/:slug 페이지가 호출.
 *     GET  /ch/:slug  지점명·경품문구만 (최소 공개)
 *     POST /submit    의견 저장 (zod 검증 + IP 스팸 제한 + 월 1회 응모)
 * - 직원(requireJwt): 목록·상태변경·추첨. 지점 스코프 보장.
 *
 * 개인정보 원칙
 * - 의견 목록은 **항상 익명**으로 내려간다(연락처·이름 미포함). 코치/지점장은 내용만 본다.
 * - 연락처는 '추첨 참여 동의'한 경우에만 저장하고, 추첨 실행 시 지난 달분은 자동 파기한다.
 * - 당첨자 연락처만 경품 전달 목적으로 조회된다.
 */
import { Hono } from "hono";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../lib/env";
import { fail, ok } from "../lib/responses";
import { requireJwt } from "../middleware/jwt";
import { getServiceClient } from "../lib/supabase";

export const feedbackRoutes = new Hono<{ Bindings: Env }>();

const HQ_ROLES = new Set(["super_admin", "hq_admin"]);
const BOARD_ROLES = new Set(["super_admin", "hq_admin", "branch_owner", "branch_manager"]);

const CATEGORIES = ["improvement", "coach_praise", "complaint", "free"] as const;

/** 같은 IP에서 10분 내 최대 제출 수 (장난·도배 방지) */
const IP_WINDOW_MIN = 10;
const IP_MAX_IN_WINDOW = 5;

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
  return p && p.status === "active" ? p : null;
}

function canAccessBranch(profile: ProfileRow, branchId: string): boolean {
  return HQ_ROLES.has(profile.role) || profile.branch_id === branchId;
}

/** KST 기준 이번 달 1일 (YYYY-MM-01) */
function kstMonthStart(d: Date = new Date()): string {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** 번호 마스킹 — 010-1234-5678 → 010-****-5678 */
function maskPhone(p: string | null | undefined): string {
  const d = digits(p);
  if (d.length < 7) return "";
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
}

// ─────────────────────────────── 공개 ───────────────────────────────

/** GET /api/feedback/ch/:slug — 공개. 지점명·안내문구만 (내부 ID 비노출) */
feedbackRoutes.get("/ch/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!slug || slug.length > 64) return fail(c, "NOT_FOUND", "잘못된 주소입니다", 404);
  const db = getServiceClient(c.env);
  const { data } = await db
    .from("member_feedback_channels")
    .select("id, title, prize_text, is_active, branches(name)")
    .eq("slug", slug)
    .maybeSingle();
  const row = data as
    | { id: string; title: string | null; prize_text: string | null; is_active: boolean; branches: { name: string } | { name: string }[] | null }
    | null;
  if (!row || !row.is_active) return fail(c, "NOT_FOUND", "종료되었거나 없는 주소입니다", 404);
  const b = Array.isArray(row.branches) ? row.branches[0] : row.branches;
  return ok(c, {
    branch_name: b?.name ?? "153복싱짐",
    title: row.title,
    prize_text: row.prize_text,
  });
});

const submitSchema = z.object({
  slug: z.string().min(1).max(64),
  category: z.enum(CATEGORIES),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  content: z.string().trim().min(2, "내용을 조금만 더 적어주세요").max(2000),
  coach_name: z.string().trim().max(40).nullable().optional(),
  draw_opt_in: z.boolean().optional().default(false),
  contact_name: z.string().trim().max(40).nullable().optional(),
  contact_phone: z.string().trim().max(40).nullable().optional(),
  privacy_agreed: z.boolean().optional().default(false),
});

/** POST /api/feedback/submit — 공개. 의견 저장 */
feedbackRoutes.post("/submit", async (c) => {
  const parsed = submitSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "입력을 확인해주세요", 400);
  }
  const body = parsed.data;
  const db = getServiceClient(c.env);

  // 채널 확인
  const { data: chData } = await db
    .from("member_feedback_channels")
    .select("id, branch_id, is_active")
    .eq("slug", body.slug)
    .maybeSingle();
  const ch = chData as { id: string; branch_id: string; is_active: boolean } | null;
  if (!ch || !ch.is_active) return fail(c, "NOT_FOUND", "종료되었거나 없는 주소입니다", 404);

  const ip = c.req.header("CF-Connecting-IP") ?? c.req.header("x-forwarded-for") ?? null;
  const ua = (c.req.header("User-Agent") ?? "").slice(0, 300);

  // 도배 방지 — 같은 IP 10분 내 5건 초과 차단
  if (ip) {
    const since = new Date(Date.now() - IP_WINDOW_MIN * 60 * 1000).toISOString();
    const { count } = await db
      .from("member_feedback")
      .select("id", { count: "exact", head: true })
      .eq("submitted_ip", ip)
      .gte("created_at", since);
    if ((count ?? 0) >= IP_MAX_IN_WINDOW) {
      return fail(c, "TOO_MANY_REQUESTS", "잠시 후 다시 시도해주세요. 소중한 의견 감사합니다!", 429);
    }
  }

  // 추첨 응모 처리 — 동의 + 연락처가 있어야 하고, 한 번호는 지점·월 1회
  const month = kstMonthStart();
  const phone = digits(body.contact_phone);
  let drawEntered = false;
  let drawNote: string | null = null;

  if (body.draw_opt_in) {
    if (!body.privacy_agreed) {
      return fail(c, "INVALID_REQUEST", "추첨 참여는 개인정보 수집 동의가 필요해요", 400);
    }
    if (phone.length < 10) {
      return fail(c, "INVALID_REQUEST", "추첨 참여하려면 연락처를 정확히 입력해주세요", 400);
    }
    const { count } = await db
      .from("member_feedback")
      .select("id", { count: "exact", head: true })
      .eq("branch_id", ch.branch_id)
      .eq("contact_phone", phone)
      .eq("draw_month", month)
      .eq("draw_opt_in", true)
      .is("contact_purged_at", null);
    if ((count ?? 0) > 0) {
      drawNote = "이번 달에는 이미 응모하셨어요. 의견은 잘 접수됐습니다!";
    } else {
      drawEntered = true;
    }
  }

  const { error } = await db.from("member_feedback").insert({
    branch_id: ch.branch_id,
    channel_id: ch.id,
    category: body.category,
    rating: body.rating ?? null,
    content: body.content,
    coach_name: body.category === "coach_praise" ? (body.coach_name ?? null) : null,
    draw_opt_in: drawEntered,
    contact_name: drawEntered ? (body.contact_name ?? null) : null,
    contact_phone: drawEntered ? phone : null,
    draw_month: drawEntered ? month : null,
    privacy_agreed_at: drawEntered ? new Date().toISOString() : null,
    submitted_ip: ip,
    user_agent: ua || null,
  });
  if (error) return fail(c, "INTERNAL_ERROR", "저장에 실패했어요. 잠시 후 다시 시도해주세요", 500);

  return ok(c, { drawEntered, note: drawNote });
});

// ─────────────────────────────── 직원 ───────────────────────────────

/** GET /api/feedback/list?branch_id&status&category — 의견 목록(항상 익명) */
feedbackRoutes.get("/list", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id") ?? "";
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필요", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !BOARD_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "다른 지점입니다", 403);

  const status = c.req.query("status");
  const category = c.req.query("category");
  // 연락처·이름은 내려보내지 않는다(익명 원칙). 응모 여부만 노출.
  let q = db
    .from("member_feedback")
    .select("id, category, rating, content, coach_name, status, staff_note, draw_opt_in, created_at, handled_at")
    .eq("branch_id", branchId)
    .order("created_at", { ascending: false })
    .limit(300);
  if (status && status !== "all") q = q.eq("status", status);
  if (category && category !== "all") q = q.eq("category", category);
  const { data, error } = await q;
  if (error) return fail(c, "INTERNAL_ERROR", "불러오기 실패", 500);
  return ok(c, { items: data ?? [] });
});

const updateSchema = z.object({
  status: z.enum(["new", "reviewing", "resolved", "dismissed"]).optional(),
  staff_note: z.string().trim().max(2000).nullable().optional(),
});

/** PUT /api/feedback/item/:id — 상태·메모 */
feedbackRoutes.put("/item/:id", requireJwt, async (c) => {
  const id = c.req.param("id");
  const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "입력을 확인해주세요", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !BOARD_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);

  const { data: cur } = await db.from("member_feedback").select("branch_id").eq("id", id).maybeSingle();
  const row = cur as { branch_id: string } | null;
  if (!row) return fail(c, "NOT_FOUND", "없는 의견입니다", 404);
  if (!canAccessBranch(profile, row.branch_id)) return fail(c, "FORBIDDEN", "다른 지점입니다", 403);

  const patch: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.status) {
    patch.handled_by = profile.id;
    patch.handled_at = new Date().toISOString();
  }
  const { error } = await db.from("member_feedback").update(patch).eq("id", id);
  if (error) return fail(c, "INTERNAL_ERROR", "저장 실패", 500);
  return ok(c, { updated: true });
});

/** GET /api/feedback/draw?branch_id&month — 이번 달 응모 현황 + 당첨 기록 */
feedbackRoutes.get("/draw", requireJwt, async (c) => {
  const branchId = c.req.query("branch_id") ?? "";
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필요", 400);
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !BOARD_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "다른 지점입니다", 403);

  const month = c.req.query("month") || kstMonthStart();
  const { count } = await db
    .from("member_feedback")
    .select("id", { count: "exact", head: true })
    .eq("branch_id", branchId)
    .eq("draw_month", month)
    .eq("draw_opt_in", true)
    .is("contact_purged_at", null);

  const { data: drawRow } = await db
    .from("member_feedback_draws")
    .select("id, draw_month, winner_name, winner_phone, prize_text, entry_count, drawn_at")
    .eq("branch_id", branchId)
    .eq("draw_month", month)
    .maybeSingle();
  const d = drawRow as
    | { id: string; draw_month: string; winner_name: string | null; winner_phone: string | null; prize_text: string | null; entry_count: number; drawn_at: string }
    | null;

  return ok(c, {
    month,
    entry_count: count ?? 0,
    winner: d
      ? {
          name: d.winner_name,
          phone: d.winner_phone,          // 경품 전달 목적 — 지점장/본사만 조회 가능
          phone_masked: maskPhone(d.winner_phone),
          prize_text: d.prize_text,
          drawn_at: d.drawn_at,
          entry_count: d.entry_count,
        }
      : null,
  });
});

const drawSchema = z.object({
  branch_id: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}-01$/).optional(),
  prize_text: z.string().trim().max(120).nullish(),
});

/** POST /api/feedback/draw — 추첨 실행(월 1회). 지난 달 응모 연락처는 자동 파기. */
feedbackRoutes.post("/draw", requireJwt, async (c) => {
  const parsed = drawSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "입력을 확인해주세요", 400);
  const { branch_id: branchId } = parsed.data;
  const month = parsed.data.month || kstMonthStart();
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile || !BOARD_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "다른 지점입니다", 403);

  // 이미 추첨했으면 중복 실행 금지
  const { data: exists } = await db
    .from("member_feedback_draws")
    .select("id")
    .eq("branch_id", branchId)
    .eq("draw_month", month)
    .maybeSingle();
  if (exists) return fail(c, "CONFLICT", "이번 달은 이미 추첨했습니다", 409);

  // 응모자 조회 → 무작위 1명
  const { data: poolData, error: poolErr } = await db
    .from("member_feedback")
    .select("id, contact_name, contact_phone")
    .eq("branch_id", branchId)
    .eq("draw_month", month)
    .eq("draw_opt_in", true)
    .is("contact_purged_at", null);
  if (poolErr) return fail(c, "INTERNAL_ERROR", "응모자 조회 실패", 500);
  const pool = (poolData ?? []) as { id: string; contact_name: string | null; contact_phone: string | null }[];
  if (pool.length === 0) return fail(c, "NOT_FOUND", "이번 달 응모자가 없습니다", 404);

  const picked = pool[Math.floor(Math.random() * pool.length)];
  if (!picked) return fail(c, "NOT_FOUND", "이번 달 응모자가 없습니다", 404);

  const { error: insErr } = await db.from("member_feedback_draws").insert({
    branch_id: branchId,
    draw_month: month,
    feedback_id: picked.id,
    winner_name: picked.contact_name,
    winner_phone: picked.contact_phone,
    prize_text: parsed.data.prize_text ?? null,
    entry_count: pool.length,
    drawn_by: profile.id,
  });
  if (insErr) return fail(c, "INTERNAL_ERROR", "추첨 기록 저장 실패", 500);

  // 개인정보 최소보관 — 지난 달 이전 응모 연락처 파기
  await db
    .from("member_feedback")
    .update({ contact_name: null, contact_phone: null, contact_purged_at: new Date().toISOString() })
    .eq("branch_id", branchId)
    .lt("draw_month", month)
    .is("contact_purged_at", null)
    .not("contact_phone", "is", null);

  return ok(c, {
    winner: {
      name: picked.contact_name,
      phone: picked.contact_phone,
      phone_masked: maskPhone(picked.contact_phone),
    },
    entry_count: pool.length,
    month,
  });
});

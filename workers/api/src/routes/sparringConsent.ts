/**
 * 스파링 참여 동의서 — 지점별 공용 링크(QR)로 회원이 직접 서명한다.
 *
 * - 공개(로그인 없음): 체육관 QR → CRM /sp/:slug 페이지가 호출 (/s/는 설문이 선점)
 *     GET  /ch/:slug   지점명·문안 버전만 (내부 ID 비노출)
 *     POST /submit     동의 저장
 * - 직원(JWT): 목록·상세·철회
 *
 * ⚠️ 분쟁 증거로 쓰이는 기록이다. 수정·삭제 API 를 만들지 않는다(철회만 표시).
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../lib/env";
import { getServiceClient } from "../lib/supabase";
import { requireJwt } from "../middleware/jwt";
import { fail, ok } from "../lib/responses";

export const sparringConsentRoutes = new Hono<{ Bindings: Env }>();

/** 현재 동의서 문안 버전 — 문구를 고치면 반드시 올린다(그때 동의한 문안을 특정하기 위해) */
const DOC_VERSION = "v1";

const IP_WINDOW_MIN = 10;
const IP_MAX_IN_WINDOW = 10;
/** 서명 이미지 상한 — 캔버스 600x200 PNG 기준 넉넉히 잡은 값 */
const MAX_SIGNATURE_LEN = 400_000;

function digits(p: string | null | undefined): string {
  return (p ?? "").replace(/\D/g, "");
}
/** 만 나이 — 생일이 지났는지까지 본다 */
function ageOf(birth: string, nowMs: number): number {
  const b = new Date(`${birth}T00:00:00+09:00`);
  const n = new Date(nowMs + 9 * 3600 * 1000);
  let a = n.getUTCFullYear() - b.getUTCFullYear();
  const m = n.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && n.getUTCDate() < b.getUTCDate())) a--;
  return a;
}
function maskPhone(p: string | null | undefined): string {
  const d = digits(p);
  if (d.length < 7) return "";
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
}

interface Profile { id: string; role: string; branch_id: string | null }
const HQ_ROLES = new Set(["super_admin", "hq_admin"]);
async function getProfile(db: ReturnType<typeof getServiceClient>, userId: string): Promise<Profile | null> {
  const { data } = await db.from("profiles").select("id, role, branch_id").eq("auth_user_id", userId).maybeSingle();
  return (data as Profile | null) ?? null;
}
function canAccessBranch(p: Profile, branchId: string): boolean {
  return HQ_ROLES.has(p.role) || p.branch_id === branchId;
}

// ─────────────────────────────── 공개 ───────────────────────────────

/** GET /api/sparring/ch/:slug — 공개. 지점명·제목만 */
sparringConsentRoutes.get("/ch/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!slug || slug.length > 64) return fail(c, "NOT_FOUND", "잘못된 주소입니다", 404);
  const db = getServiceClient(c.env);
  const { data } = await db
    .from("sparring_consent_channels")
    .select("id, title, is_active, branches(name)")
    .eq("slug", slug)
    .maybeSingle();
  const row = data as
    | { id: string; title: string | null; is_active: boolean; branches: { name: string } | { name: string }[] | null }
    | null;
  if (!row || !row.is_active) return fail(c, "NOT_FOUND", "종료되었거나 없는 주소입니다", 404);
  const b = Array.isArray(row.branches) ? row.branches[0] : row.branches;
  return ok(c, { branch_name: b?.name ?? "153복싱짐", title: row.title, doc_version: DOC_VERSION });
});

const submitSchema = z.object({
  slug: z.string().min(1).max(64),
  member_name: z.string().trim().min(2, "성함을 입력해주세요").max(40),
  phone: z.string().trim().min(9, "연락처를 확인해주세요").max(40),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "생년월일을 확인해주세요"),
  guardian_name: z.string().trim().max(40).nullable().optional(),
  guardian_phone: z.string().trim().max(40).nullable().optional(),
  guardian_relation: z.string().trim().max(20).nullable().optional(),
  agree_risk: z.boolean(),
  agree_health: z.boolean(),
  agree_rules: z.boolean(),
  agree_emergency: z.boolean(),
  agree_privacy: z.boolean(),
  health_notes: z.string().trim().max(1000).nullable().optional(),
  signature: z.string().max(MAX_SIGNATURE_LEN).nullable().optional(),
});

/** POST /api/sparring/submit — 공개. 동의 저장 */
sparringConsentRoutes.post("/submit", async (c) => {
  const parsed = submitSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "입력을 확인해주세요", 400);
  const body = parsed.data;
  const db = getServiceClient(c.env);

  const { data: chData } = await db
    .from("sparring_consent_channels")
    .select("id, branch_id, is_active")
    .eq("slug", body.slug)
    .maybeSingle();
  const ch = chData as { id: string; branch_id: string; is_active: boolean } | null;
  if (!ch || !ch.is_active) return fail(c, "NOT_FOUND", "종료되었거나 없는 주소입니다", 404);

  // 동의 항목은 전부 필수 — 하나라도 빠지면 동의서로 성립하지 않는다.
  if (!body.agree_risk || !body.agree_health || !body.agree_rules || !body.agree_emergency || !body.agree_privacy) {
    return fail(c, "INVALID_REQUEST", "모든 항목에 동의해야 접수됩니다", 400);
  }
  if (!body.signature || body.signature.length < 100) {
    return fail(c, "INVALID_REQUEST", "서명을 입력해주세요", 400);
  }

  const age = ageOf(body.birth_date, Date.now());
  if (!Number.isFinite(age) || age < 0 || age > 120) return fail(c, "INVALID_REQUEST", "생년월일을 확인해주세요", 400);
  const isMinor = age < 19;   // 민법상 미성년자 = 만 19세 미만
  if (isMinor) {
    if (!body.guardian_name || !body.guardian_phone || digits(body.guardian_phone).length < 9) {
      return fail(c, "INVALID_REQUEST", "미성년자는 보호자 성함·연락처가 필요합니다", 400);
    }
  }

  const ip = c.req.header("CF-Connecting-IP") ?? c.req.header("x-forwarded-for") ?? null;
  const ua = (c.req.header("User-Agent") ?? "").slice(0, 300);

  // 도배 방지
  if (ip) {
    const since = new Date(Date.now() - IP_WINDOW_MIN * 60 * 1000).toISOString();
    const { count } = await db
      .from("sparring_consents")
      .select("id", { count: "exact", head: true })
      .eq("submitted_ip", ip)
      .gte("created_at", since);
    if ((count ?? 0) >= IP_MAX_IN_WINDOW) return fail(c, "TOO_MANY_REQUESTS", "잠시 후 다시 시도해주세요", 429);
  }

  const { error } = await db.from("sparring_consents").insert({
    branch_id: ch.branch_id,
    channel_id: ch.id,
    member_name: body.member_name,
    phone: digits(body.phone),
    birth_date: body.birth_date,
    is_minor: isMinor,
    guardian_name: isMinor ? body.guardian_name : null,
    guardian_phone: isMinor ? digits(body.guardian_phone) : null,
    guardian_relation: isMinor ? (body.guardian_relation ?? null) : null,
    agree_risk: true, agree_health: true, agree_rules: true, agree_emergency: true, agree_privacy: true,
    health_notes: body.health_notes ?? null,
    signature: body.signature,
    doc_version: DOC_VERSION,
    submitted_ip: ip,
    user_agent: ua,
  });
  if (error) return fail(c, "DB_ERROR", error.message, 500);

  return ok(c, { saved: true, is_minor: isMinor });
});

// ─────────────────────────────── 직원 ───────────────────────────────

/** GET /api/sparring/list?branch_id=&q= — 직원. 목록(서명 제외, 번호 마스킹) */
sparringConsentRoutes.get("/list", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  const branchId = c.req.query("branch_id") ?? profile.branch_id ?? "";
  if (!branchId) return fail(c, "INVALID_REQUEST", "branch_id 필수", 400);
  if (!canAccessBranch(profile, branchId)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  const q = (c.req.query("q") ?? "").trim();

  let query = db
    .from("sparring_consents")
    .select("id, member_name, phone, birth_date, is_minor, guardian_name, health_notes, doc_version, revoked_at, created_at")
    .eq("branch_id", branchId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (q) query = query.or(`member_name.ilike.%${q}%,phone.ilike.%${digits(q) || q}%`);

  const { data, error } = await query;
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  type Row = { phone: string | null } & Record<string, unknown>;
  const rows = ((data as Row[] | null) ?? []).map((r) => ({ ...r, phone: maskPhone(r.phone) }));

  // 채널 주소도 같이 — 화면에서 QR·링크를 바로 보여주기 위해
  const { data: chData } = await db
    .from("sparring_consent_channels")
    .select("slug, is_active, title")
    .eq("branch_id", branchId)
    .maybeSingle();

  return ok(c, { rows, channel: chData ?? null });
});

/** GET /api/sparring/:id — 직원. 상세(서명·연락처 원문 포함) */
sparringConsentRoutes.get("/:id", requireJwt, async (c) => {
  const id = c.req.param("id");
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);

  const { data, error } = await db.from("sparring_consents").select("*").eq("id", id).maybeSingle();
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  const row = data as { branch_id: string } | null;
  if (!row) return fail(c, "NOT_FOUND", "없는 기록입니다", 404);
  if (!canAccessBranch(profile, row.branch_id)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  return ok(c, { consent: row });
});

/** POST /api/sparring/:id/revoke — 직원. 철회 표시(기록은 남긴다) */
sparringConsentRoutes.post("/:id/revoke", requireJwt, async (c) => {
  const id = c.req.param("id");
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "프로필을 찾을 수 없습니다", 403);
  const { data: cur } = await db.from("sparring_consents").select("branch_id").eq("id", id).maybeSingle();
  const row = cur as { branch_id: string } | null;
  if (!row) return fail(c, "NOT_FOUND", "없는 기록입니다", 404);
  if (!canAccessBranch(profile, row.branch_id)) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);

  const { error } = await db.from("sparring_consents").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { revoked: true });
});

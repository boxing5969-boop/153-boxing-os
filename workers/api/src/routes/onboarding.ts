/**
 * 153os SaaS — Self-service onboarding (public endpoint, no JWT required)
 *
 * POST /api/onboarding/signup
 *   1. Validate input
 *   2. Create Supabase auth user (Admin API)
 *   3. Provision company + branch + profile via DB function
 *   4. Return company_id + trial info
 *
 * POST /api/onboarding/check-slug  (slug 중복 확인)
 */

import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../lib/env";
import { fail, ok } from "../lib/responses";
import { getServiceClient } from "../lib/supabase";

export const onboardingRoutes = new Hono<{ Bindings: Env }>();

// ── slug validation: 영문 소문자/숫자/하이픈, 3-30자
const slugRe = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

const signupSchema = z.object({
  // 브랜드 정보
  company_name:  z.string().min(2).max(60),
  slug:          z.string().regex(slugRe, "슬러그는 영문 소문자·숫자·하이픈만 사용 가능합니다 (3-30자)"),
  // 첫 지점
  branch_name:   z.string().min(1).max(60),
  branch_phone:  z.string().max(20).optional().default(""),
  // 관리자 계정
  admin_name:    z.string().min(1).max(40),
  admin_phone:   z.string().max(20).optional().default(""),
  admin_email:   z.string().email(),
  admin_password: z.string().min(8, "비밀번호는 8자 이상이어야 합니다"),
});

// POST /api/onboarding/check-slug
onboardingRoutes.post("/check-slug", async (c) => {
  const body = await c.req.json().catch(() => null);
  const slug = String(body?.slug ?? "").toLowerCase().trim();
  if (!slug) return fail(c, "INVALID_REQUEST", "slug 필드가 필요합니다", 400);

  const db = getServiceClient(c.env);
  const { data, error } = await db.rpc("check_slug_available", { _slug: slug });
  if (error) return fail(c, "DB_ERROR", error.message, 500);
  return ok(c, { available: Boolean(data) });
});

// POST /api/onboarding/signup
onboardingRoutes.post("/signup", async (c) => {
  const parsed = signupSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다";
    return fail(c, "INVALID_REQUEST", msg, 400);
  }
  const d = parsed.data;

  const db = getServiceClient(c.env);

  // 1) slug 중복 확인
  const { data: slugOk } = await db.rpc("check_slug_available", { _slug: d.slug });
  if (!slugOk) {
    return fail(c, "SLUG_TAKEN", "이미 사용 중인 슬러그입니다. 다른 이름을 사용해 주세요.", 409);
  }

  // 2) Supabase Admin API로 auth user 생성
  const adminApiUrl = `${c.env.SUPABASE_URL}/auth/v1/admin/users`;
  const createUserRes = await fetch(adminApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": c.env.SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": `Bearer ${c.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      email: d.admin_email,
      password: d.admin_password,
      email_confirm: true, // 이메일 인증 건너뜀 (즉시 사용 가능)
    }),
  });

  if (!createUserRes.ok) {
    const errBody = await createUserRes.json().catch(() => ({})) as Record<string, unknown>;
    const msg = (errBody.msg ?? errBody.message ?? "이메일이 이미 사용 중이거나 유효하지 않습니다") as string;
    return fail(c, "AUTH_ERROR", msg, 400);
  }

  const authUser = await createUserRes.json() as { id: string };
  const authUserId = authUser.id;

  // 3) DB provision (company + branch + profile)
  const { data: companyId, error: provErr } = await db.rpc("provision_new_company", {
    _company_name:  d.company_name,
    _slug:          d.slug,
    _branch_name:   d.branch_name,
    _branch_phone:  d.branch_phone,
    _admin_name:    d.admin_name,
    _admin_phone:   d.admin_phone,
    _auth_user_id:  authUserId,
  });

  if (provErr) {
    // 실패 시 auth user 롤백 (best-effort)
    await fetch(`${c.env.SUPABASE_URL}/auth/v1/admin/users/${authUserId}`, {
      method: "DELETE",
      headers: {
        "apikey": c.env.SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${c.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }).catch(() => {});
    return fail(c, "PROVISION_ERROR", provErr.message, 500);
  }

  // 4) trial 정보 조회
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  return ok(c, {
    company_id:   companyId,
    slug:         d.slug,
    trial_ends_at: trialEndsAt,
    message:      `153os에 오신 것을 환영합니다! 14일 무료 체험이 시작되었습니다.`,
  }, undefined, 201);
});

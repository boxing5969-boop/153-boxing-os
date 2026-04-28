import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../lib/env";
import { fail, ok } from "../lib/responses";
import { requireJwt } from "../middleware/jwt";
import { getServiceClient } from "../lib/supabase";

export const staffRoutes = new Hono<{ Bindings: Env }>();

const HQ_ROLES = new Set(["super_admin", "hq_admin"]);
const BRANCH_REQUIRED_ROLES = new Set([
  "branch_owner",
  "branch_manager",
  "coach",
]);

const inviteSchema = z.object({
  email: z.string().email().max(200),
  name: z.string().min(1).max(100),
  role: z.enum([
    "super_admin",
    "hq_admin",
    "branch_owner",
    "branch_manager",
    "coach",
  ]),
  branch_id: z.string().uuid().optional(),
  phone: z.string().max(40).optional(),
});

function generateTempPassword(): string {
  // 0/O/I/1/l 같은 헷갈리는 문자 제외
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz";
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  let pwd = "";
  for (let i = 0; i < bytes.length; i++) {
    const code = bytes[i] as number;
    pwd += chars.charAt(code % chars.length);
  }
  return pwd;
}

interface CallerProfile {
  id: string;
  role: string;
  company_id: string | null;
  branch_id: string | null;
}

async function loadCallerProfile(
  c: { env: Env; get: (k: "user") => { id: string } }
): Promise<CallerProfile | null> {
  const user = c.get("user");
  const db = getServiceClient(c.env);
  const { data } = await db
    .from("profiles")
    .select("id,role,company_id,branch_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  return (data as CallerProfile | null) ?? null;
}

staffRoutes.post("/invite", requireJwt, async (c) => {
  const parsed = inviteSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return fail(c, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "Invalid body", 400);
  }

  const caller = await loadCallerProfile(c);
  if (!caller) return fail(c, "PERMISSION_DENIED", "프로필을 찾을 수 없습니다", 403);
  if (!HQ_ROLES.has(caller.role)) {
    return fail(c, "PERMISSION_DENIED", "직원 초대 권한이 없습니다 (hq 만 가능)", 403);
  }
  // hq_admin 은 super_admin 을 만들 수 없음
  if (parsed.data.role === "super_admin" && caller.role !== "super_admin") {
    return fail(c, "PERMISSION_DENIED", "super_admin 은 super_admin 만 발급 가능합니다", 403);
  }
  // 지점 필수 역할 검증
  if (BRANCH_REQUIRED_ROLES.has(parsed.data.role) && !parsed.data.branch_id) {
    return fail(c, "INVALID_REQUEST", "branch_id 가 필요한 역할입니다", 400);
  }

  const db = getServiceClient(c.env);

  // 이메일 중복 확인 (이미 auth.users 에 있으면 거절)
  const password = generateTempPassword();

  const { data: createdData, error: authErr } = await db.auth.admin.createUser({
    email: parsed.data.email,
    password,
    email_confirm: true,
    user_metadata: { name: parsed.data.name, invited_role: parsed.data.role },
  });
  if (authErr || !createdData?.user) {
    return fail(c, "INTERNAL_ERROR", authErr?.message ?? "auth 사용자 생성 실패", 500);
  }
  const newUserId = createdData.user.id;

  // company_id 결정 — caller 의 company_id 사용 (단일 본사 가정)
  const companyId = caller.company_id;

  const { data: insertedRaw, error: profileErr } = await db
    .from("profiles")
    .insert({
      auth_user_id: newUserId,
      role: parsed.data.role,
      company_id: companyId,
      branch_id: parsed.data.branch_id ?? null,
      name: parsed.data.name,
      phone: parsed.data.phone ?? null,
      status: "active",
    })
    .select("id")
    .single();
  if (profileErr) {
    // 롤백: auth.users 삭제 시도
    await db.auth.admin.deleteUser(newUserId).catch(() => {});
    return fail(c, "INTERNAL_ERROR", `프로필 생성 실패: ${profileErr.message}`, 500);
  }
  const inserted = insertedRaw as { id: string };

  return ok(
    c,
    {
      profile_id: inserted.id,
      user_id: newUserId,
      email: parsed.data.email,
      name: parsed.data.name,
      role: parsed.data.role,
      temp_password: password,
    },
    "직원이 추가되었습니다. 임시 비밀번호는 다시 조회할 수 없으니 즉시 본인에게 안전하게 전달하세요."
  );
});

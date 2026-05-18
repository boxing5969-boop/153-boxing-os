import type { MiddlewareHandler } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "../lib/env";
import { fail } from "../lib/responses";

export interface JwtUser {
  id: string;
  email?: string;
  role?: string;
}

declare module "hono" {
  interface ContextVariableMap {
    user: JwtUser;
  }
}

// Supabase가 ES256(신규) 또는 HS256(구형)을 사용하므로 JWKS로 검증
// JWKS는 Workers isolate 단위로 캐시됨 (요청마다 재생성 방지)
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedSupabaseUrl = "";

function getJwks(supabaseUrl: string) {
  if (!cachedJwks || cachedSupabaseUrl !== supabaseUrl) {
    cachedSupabaseUrl = supabaseUrl;
    cachedJwks = createRemoteJWKSet(
      new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)
    );
  }
  return cachedJwks;
}

export const requireJwt: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return fail(c, "AUTH_REQUIRED", "Authorization header missing", 401);
  }

  const token = auth.slice("Bearer ".length).trim();
  if (!c.env.SUPABASE_URL) {
    return fail(c, "INTERNAL_ERROR", "Supabase URL not configured", 500);
  }

  try {
    // 1차 시도: JWKS (ES256 신규 Supabase 프로젝트)
    let payload: Record<string, unknown>;
    try {
      const jwks = getJwks(c.env.SUPABASE_URL);
      const result = await jwtVerify(token, jwks, { audience: "authenticated" });
      payload = result.payload as Record<string, unknown>;
    } catch {
      // 2차 시도: HS256 (구형 Supabase 또는 JWT_SECRET 방식)
      if (!c.env.SUPABASE_JWT_SECRET) throw new Error("JWT secret not configured");
      const secret = new TextEncoder().encode(c.env.SUPABASE_JWT_SECRET);
      const result = await jwtVerify(token, secret, { audience: "authenticated" });
      payload = result.payload as Record<string, unknown>;
    }

    if (!payload.sub) {
      return fail(c, "AUTH_REQUIRED", "JWT payload missing sub", 401);
    }
    c.set("user", {
      id: payload.sub as string,
      email: typeof payload.email === "string" ? payload.email : undefined,
      role: typeof payload.role === "string" ? payload.role : undefined,
    });
    await next();
    return;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return fail(c, "AUTH_REQUIRED", `Invalid JWT: ${msg}`, 401);
  }
};

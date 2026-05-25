/**
 * Supabase JWT 검증 미들웨어.
 * - 우선순위 1: SUPABASE_JWT_SECRET (HS256) 로컬 검증 (빠름, 추천)
 * - 우선순위 2: SUPABASE_URL 의 JWKS endpoint (ES256, 신형 Supabase)
 * - 실패 시 AuthError 401
 *
 * req.user 에 { id, email, role } 첨부.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { NextFunction, Request, Response } from "express";
import { loadConfig } from "../config";
import { AuthError } from "../lib/errors";

export interface AuthenticatedUser {
  id: string;        // auth.users.id (UUID)
  email?: string;
  role?: string;     // 'authenticated' 등
  raw: JWTPayload;
}

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(supabaseUrl: string) {
  if (cachedJwks) return cachedJwks;
  cachedJwks = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
  return cachedJwks;
}

/**
 * Authorization: Bearer <jwt> 검증.
 * 검증 성공 시 req.user 첨부 + next() 호출.
 */
export async function verifySupabaseUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.header("authorization");
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
      throw new AuthError("missing bearer token");
    }
    const token = authHeader.slice(7).trim();
    if (!token) throw new AuthError("empty bearer token");

    const cfg = loadConfig();
    let payload: JWTPayload;

    if (cfg.SUPABASE_JWT_SECRET) {
      const secret = new TextEncoder().encode(cfg.SUPABASE_JWT_SECRET);
      const verified = await jwtVerify(token, secret, { algorithms: ["HS256"] });
      payload = verified.payload;
    } else {
      const jwks = getJwks(cfg.SUPABASE_URL);
      const verified = await jwtVerify(token, jwks);
      payload = verified.payload;
    }

    const sub = typeof payload.sub === "string" ? payload.sub : undefined;
    if (!sub) throw new AuthError("token missing sub claim");

    req.user = {
      id: sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
      role: typeof payload.role === "string" ? payload.role : undefined,
      raw: payload,
    };
    next();
  } catch (err) {
    if (err instanceof AuthError) {
      next(err);
      return;
    }
    next(new AuthError("invalid token", { reason: err instanceof Error ? err.message : "unknown" }));
  }
}

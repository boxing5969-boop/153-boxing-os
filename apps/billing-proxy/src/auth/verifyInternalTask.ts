/**
 * /tasks/* 엔드포인트용 내부 인증 미들웨어.
 *
 * 운영 (Cloud Tasks):
 *   Cloud Tasks 가 OIDC ID 토큰을 Authorization 헤더에 붙임 (audience = Cloud Run URL).
 *   Google JWKS 로 검증해야 함 — TODO: jose + google-auth-library 로 구현.
 *
 * 개발/CI:
 *   X-Internal-Secret 헤더와 INTERNAL_TASK_SECRET 환경변수 비교.
 */
import type { NextFunction, Request, Response } from "express";
import { loadConfig } from "../config";
import { AuthError } from "../lib/errors";

export async function verifyInternalTask(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const cfg = loadConfig();

    // 1) OIDC (production)
    // TODO: implement OIDC verification
    //   const idToken = req.header("authorization")?.replace(/^Bearer\s+/i, "");
    //   if (idToken) {
    //     const payload = await verifyGoogleIdToken(idToken, expectedAudience);
    //     if (payload.email_verified && payload.email === serviceAccountEmail) return next();
    //   }

    // 2) Shared secret (development / fallback)
    const provided = req.header("x-internal-secret");
    if (!cfg.INTERNAL_TASK_SECRET) {
      throw new AuthError("INTERNAL_TASK_SECRET not configured");
    }
    if (!provided || provided !== cfg.INTERNAL_TASK_SECRET) {
      throw new AuthError("invalid internal task auth");
    }
    next();
  } catch (err) {
    if (err instanceof AuthError) {
      next(err);
      return;
    }
    next(new AuthError("internal task auth failed"));
  }
}

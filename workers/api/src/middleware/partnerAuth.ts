import type { MiddlewareHandler } from "hono";
import type { Env } from "../lib/env";
import { fail } from "../lib/responses";

declare module "hono" {
  interface ContextVariableMap {
    rankingUserId: string;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 길이가 같은 문자열에 한해 timing-safe 비교. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * 외부 파트너(랭킹업앱) 호출 인증.
 *  - X-Partner-Key: env.PARTNER_API_KEY 와 timing-safe 비교
 *  - X-Ranking-User-Id: 파트너 시스템의 user.id (uuid). members.ranking_app_user_id 매칭에 사용.
 *
 * ⚠ PARTNER_API_KEY 는 파트너 서버에서만 사용 — 브라우저 노출 금지.
 *   파트너 측은 자체 백엔드에서 본 API 를 호출해야 함.
 */
export const requirePartnerAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const partnerKey = c.req.header("X-Partner-Key");
  const rankingUserId = c.req.header("X-Ranking-User-Id");

  if (!partnerKey || !rankingUserId) {
    return fail(
      c,
      "AUTH_REQUIRED",
      "X-Partner-Key 와 X-Ranking-User-Id 가 모두 필요합니다",
      401
    );
  }
  if (!c.env.PARTNER_API_KEY) {
    return fail(c, "INTERNAL_ERROR", "PARTNER_API_KEY 가 설정되지 않았습니다", 500);
  }
  if (!constantTimeEqual(partnerKey, c.env.PARTNER_API_KEY)) {
    return fail(c, "INVALID_PARTNER_KEY", "파트너 키가 일치하지 않습니다", 401);
  }
  if (!UUID_RE.test(rankingUserId)) {
    return fail(c, "INVALID_REQUEST", "X-Ranking-User-Id 는 uuid 형식이어야 합니다", 400);
  }

  c.set("rankingUserId", rankingUserId);
  await next();
  return;
};

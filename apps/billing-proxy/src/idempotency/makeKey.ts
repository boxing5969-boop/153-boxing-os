/**
 * 멱등키 유틸.
 * 클라이언트는 idempotency_key 를 직접 제공해야 함 — 우리는 가공만.
 *
 * 규칙:
 *   - 길이 8~128
 *   - URL-safe 문자 허용 [A-Za-z0-9_-]
 *   - 환불 키는 debit 키에서 파생: `refund:${debitKey}` (같은 debit 의 환불은 항상 같은 환불키)
 */
import { ValidationError } from "../lib/errors";

const KEY_RE = /^[A-Za-z0-9_\-:.]{8,128}$/;

export function validateIdempotencyKey(key: string): string {
  if (!key || typeof key !== "string") throw new ValidationError("idempotency_key required");
  if (!KEY_RE.test(key)) {
    throw new ValidationError("invalid idempotency_key format", { hint: "8-128 chars, [A-Za-z0-9_-:.]" });
  }
  return key;
}

export function refundKeyOf(debitKey: string): string {
  return `refund:${debitKey}`.slice(0, 128);
}

/**
 * 한국 휴대전화/지역전화 정규화 + 검증.
 * - 입력: 010-1234-5678, 01012345678, +82 10 1234 5678, 02-1234-5678 등
 * - 출력: 숫자만 (digits) — Aligo 형식
 */
import { ValidationError } from "../lib/errors";

/** +82 시작이면 0 으로 치환, 모든 비-숫자 제거. 결과 길이 9~11 만 통과. */
export function normalizeKrPhone(input: string): string {
  if (!input || typeof input !== "string") {
    throw new ValidationError("phone required");
  }
  let s = input.trim();
  if (s.startsWith("+82")) s = "0" + s.slice(3);
  else if (s.startsWith("82") && s.length >= 11) s = "0" + s.slice(2);
  const digits = s.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 11) {
    throw new ValidationError("invalid phone number length", { input, normalized: digits });
  }
  if (!digits.startsWith("0")) {
    throw new ValidationError("phone must start with 0", { input, normalized: digits });
  }
  return digits;
}

/** EUC-KR 바이트 수 계산 — Aligo SMS/LMS 분기 기준 (90 byte). */
export function calcKrBytes(text: string): number {
  let n = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    n += code > 127 ? 2 : 1;
  }
  return n;
}

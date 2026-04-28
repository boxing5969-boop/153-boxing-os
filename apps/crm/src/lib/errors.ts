/**
 * 통합 에러 메시지 추출.
 * Supabase PostgrestError (plain object with .message) + Error instance + 알 수 없는 값 모두 처리.
 * 기존 `error instanceof Error ? error.message : "알 수 없는 오류"` 가 PostgrestError 를
 * "알 수 없는 오류" 로 가려서 디버그가 안 됐던 문제 해결.
 */
export function errorMessage(err: unknown): string {
  if (!err) return "알 수 없는 오류";
  if (err instanceof Error) return err.message || "알 수 없는 오류";
  if (typeof err === "object" && err !== null) {
    const obj = err as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    if (typeof obj.message === "string" && obj.message) {
      let msg = obj.message;
      if (typeof obj.code === "string" && obj.code) msg += ` (${obj.code})`;
      if (typeof obj.hint === "string" && obj.hint) msg += ` — ${obj.hint}`;
      return msg;
    }
    if (typeof obj.details === "string" && obj.details) return obj.details;
  }
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return "알 수 없는 오류";
  }
}

/**
 * 외부 API 오류 분류 — 재시도 vs 영구 실패.
 *
 * 재시도: 네트워크 일시 장애, 5xx, 429 (Too Many Requests), Aligo 일시 오류 등
 *         → Cloud Tasks 가 자동 재시도하도록 task 핸들러가 HTTP 503/429 반환
 *
 * 영구 실패: 잘못된 번호, 잘못된 인증, 잘못된 본문, 한도 초과
 *           → 즉시 환불 + status='failed' + 200 반환 (재시도 중단)
 */
export type RetryDecision = "retry" | "permanent_failure";

export interface ProviderErrorInfo {
  provider: "aligo" | "payssam" | "kt_call_assistant" | string;
  resultCode: string;
  resultMessage?: string;
  httpStatus?: number;
}

/**
 * 결정 규칙:
 *  - NETWORK_ERROR → retry
 *  - HTTP 5xx, 408, 429 → retry
 *  - HTTP 4xx (except 408/429) → permanent
 *  - Aligo 코드별 매핑:
 *      - "1" success (caller 가 ok 체크. 여기로 안 와야 함)
 *      - "-99" 서버 에러 → retry
 *      - "-101"~"-108" 인증/한도/포맷 → permanent
 *      - 그 외 음수 → permanent (보수적)
 *  - Payssam: HTTP 코드만 신뢰
 *  - 알 수 없는 경우 → retry (최대 시도 횟수는 Cloud Tasks 큐 설정으로 제한)
 */
export function classifyProviderError(info: ProviderErrorInfo): RetryDecision {
  const code = info.resultCode.toUpperCase();
  if (code === "NETWORK_ERROR") return "retry";

  if (typeof info.httpStatus === "number") {
    if (info.httpStatus >= 500) return "retry";
    if (info.httpStatus === 408 || info.httpStatus === 429) return "retry";
    if (info.httpStatus >= 400) return "permanent_failure";
  }

  if (info.provider === "aligo") {
    // Aligo: result_code 가 "1"=성공, 음수=실패
    if (code === "-99") return "retry";
    if (/^-(\d+)$/.test(code)) {
      // 그 외 음수 코드는 영구 실패로 처리 (잘못된 번호/한도/인증 등)
      return "permanent_failure";
    }
  }

  // 숫자 HTTP-like 코드
  const num = Number(code);
  if (!Number.isNaN(num)) {
    if (num >= 500) return "retry";
    if (num === 408 || num === 429) return "retry";
    if (num >= 400) return "permanent_failure";
  }

  // 알 수 없음 → 보수적 재시도 (큐 max attempts 가 무한루프 방지)
  return "retry";
}

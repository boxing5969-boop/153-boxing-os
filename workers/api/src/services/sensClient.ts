/**
 * NAVER Cloud SENS (Simple & Easy Notification Service) 클라이언트
 *
 * Phase 1 라이브 SMS 발송 경로. docs/sens-migration.md 참고.
 *
 * 인증: NCP API Gateway HMAC-SHA256 서명
 * 발송: POST /sms/v2/services/{serviceId}/messages
 *
 * 이 모듈은 순수 함수만 export 하여 단위 테스트가 쉽게 한다.
 * (per-branch config 로딩 및 DB 접근은 smsNotifier.ts 가 담당.)
 */

const SENS_BASE_URL = "https://sens.apigw.ntruss.com";

export type SensMessageType = "SMS" | "LMS" | "MMS";

export interface SensConfig {
  accessKey: string;
  secretKey: string;
  serviceId: string;
  fromPhone: string;
}

export interface SensSendResult {
  success: boolean;
  error?: string;
  requestId?: string;
  statusCode?: string;
}

// ────────────────────────────────────────────────────────────────
// 발신/수신번호 정규화
// ────────────────────────────────────────────────────────────────

/**
 * 하이픈·공백·괄호 등을 모두 제거하고 숫자만 남긴다.
 * - "010-1234-5678"  → "01012345678"
 * - "(010) 1234-5678" → "01012345678"
 * - "+82-10-1234-5678" → "821012345678"
 */
export function normalizePhone(phone: string): string {
  return (phone ?? "").replace(/\D/g, "");
}

/**
 * 발송 가능한 번호 형식인지 확인 (정규화 후 9~15자리).
 * 국제 SMS 가능성을 고려해 15자리까지 허용.
 */
export function isValidPhone(phone: string): boolean {
  const n = normalizePhone(phone);
  return n.length >= 9 && n.length <= 15;
}

// ────────────────────────────────────────────────────────────────
// 메시지 타입 자동 판단 (EUC-KR 기준 90byte 초과 시 LMS)
// ────────────────────────────────────────────────────────────────

/** EUC-KR 바이트 계산 — 한글 2byte, ASCII 1byte */
export function calcEucKrBytes(text: string): number {
  let count = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    count += code > 127 ? 2 : 1;
  }
  return count;
}

export function inferMessageType(content: string): SensMessageType {
  return calcEucKrBytes(content) > 90 ? "LMS" : "SMS";
}

// ────────────────────────────────────────────────────────────────
// HMAC-SHA256 서명 생성 (NCP API Gateway 규격)
// ────────────────────────────────────────────────────────────────

/**
 * NCP API Gateway HMAC-SHA256 서명 (v2).
 *
 * message =
 *   METHOD + " " + URI + "\n"
 *   + timestamp + "\n"
 *   + accessKey
 *
 * signature = Base64( HMAC-SHA256(secretKey, message) )
 *
 * Cloudflare Workers 의 Web Crypto API 사용.
 */
export async function buildSignature(
  method: string,
  uri: string,
  timestamp: string,
  accessKey: string,
  secretKey: string,
): Promise<string> {
  const message = `${method} ${uri}\n${timestamp}\n${accessKey}`;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(message),
  );
  return arrayBufferToBase64(sigBuf);
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  // for..of 로 number 로 좁혀져 noUncheckedIndexedAccess 와 충돌 없음
  for (const b of bytes) binary += String.fromCharCode(b);
  // btoa 는 Cloudflare Workers 환경에서 사용 가능
  return btoa(binary);
}

// ────────────────────────────────────────────────────────────────
// SMS 발송
// ────────────────────────────────────────────────────────────────

/**
 * NCP SENS 로 SMS/LMS/MMS 발송.
 * type 미지정 시 본문 바이트 길이로 자동 분기.
 *
 * 호출부(smsNotifier.ts)는 per-branch config 를 DB 에서 로드해 전달한다.
 */
export async function sendSensSms(
  config: SensConfig,
  toPhone: string,
  content: string,
  type?: SensMessageType,
): Promise<SensSendResult> {
  if (!isValidPhone(toPhone)) {
    return { success: false, error: `유효하지 않은 수신번호: ${toPhone}` };
  }
  if (!isValidPhone(config.fromPhone)) {
    return { success: false, error: `유효하지 않은 발신번호: ${config.fromPhone}` };
  }
  if (!config.serviceId) {
    return { success: false, error: "NCP SENS Service ID 미설정" };
  }
  if (!config.accessKey || !config.secretKey) {
    return { success: false, error: "NCP SENS Access Key / Secret Key 미설정" };
  }

  const msgType: SensMessageType = type ?? inferMessageType(content);
  const method = "POST";
  const uri = `/sms/v2/services/${encodeURIComponent(config.serviceId)}/messages`;
  const timestamp = String(Date.now());

  let signature: string;
  try {
    signature = await buildSignature(
      method,
      uri,
      timestamp,
      config.accessKey,
      config.secretKey,
    );
  } catch (err) {
    return {
      success: false,
      error: `서명 생성 실패: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const body = {
    type: msgType,
    from: normalizePhone(config.fromPhone),
    content,
    messages: [{ to: normalizePhone(toPhone), content }],
  };

  try {
    const res = await fetch(`${SENS_BASE_URL}${uri}`, {
      method,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "x-ncp-apigw-timestamp": timestamp,
        "x-ncp-iam-access-key": config.accessKey,
        "x-ncp-apigw-signature-v2": signature,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        success: false,
        error: `NCP SENS ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    const json = (await res.json().catch(() => ({}))) as {
      requestId?: string;
      statusCode?: string;
      statusName?: string;
    };
    // SENS 정상 응답: statusCode "202" (Accepted)
    return {
      success: true,
      requestId: json.requestId,
      statusCode: json.statusCode,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "fetch error",
    };
  }
}

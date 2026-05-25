/**
 * Provider 인터페이스 — Aligo (문자) + Payssam (결제).
 *
 * 정규화된 응답 모양:
 *   - success: boolean — 외부 호출 성공 여부 (transport 단)
 *   - status:  "sent" | "failed"  (메시지) / "created" | "failed" (청구서)
 *   - providerMessageId / providerInvoiceId — 외부 시스템의 식별자
 *   - errorMessage  — 실패 시 사용자 친화 메시지
 *   - resultCode    — provider 원본 코드 (Aligo "1", Payssam HTTP 상태 등)
 *   - raw           — 디버깅용 원본 응답 (로그·웹훅 분석)
 *
 * 보안 원칙:
 *   - 응답 raw 에 시크릿이 포함되면 안 됨 (provider 응답엔 보통 없음)
 *   - 요청 로깅 시 API key/secret 절대 포함 금지 → redact 헬퍼
 */

// ============================================================
// Aligo
// ============================================================
export interface AligoSmsInput {
  sender: string;          // 발신번호 (digits)
  receiver: string;        // 수신번호 (digits)
  msg: string;
}

export interface AligoLmsInput extends AligoSmsInput {
  title?: string;          // LMS 제목 (선택, 기본은 본문 첫 30자)
}

export interface AligoMmsInput extends AligoLmsInput {
  /** 이미지 URL — 실 Aligo MMS API 는 form-data 파일 업로드 필요. 현재는 placeholder. */
  imageUrl?: string;
  /** 이미지 바이너리 — placeholder. */
  imageBuffer?: Uint8Array;
  imageContentType?: string;  // 'image/jpeg' 등
}

export interface AligoSendResult {
  success: boolean;
  status: "sent" | "failed";
  providerMessageId?: string;
  resultCode: string;        // Aligo "1" = success
  errorMessage?: string;
  raw: unknown;              // 디버깅용 (API 키 미포함)
}

export interface AligoProvider {
  sendSms(input: AligoSmsInput): Promise<AligoSendResult>;
  sendLms(input: AligoLmsInput): Promise<AligoSendResult>;
  sendMms(input: AligoMmsInput): Promise<AligoSendResult>;
}

// ============================================================
// Payssam (결제선생)
// ============================================================
export interface PayssamCreateInvoiceInput {
  amountKrw: number;
  customerName?: string;
  customerPhone: string;
  itemName: string;
  memo?: string;
  idempotencyKey: string;
  callbackUrl?: string;
}

export interface PayssamCreateInvoiceResult {
  success: boolean;
  status: "created" | "failed";
  providerInvoiceId?: string;
  paymentUrl?: string;
  resultCode: string;
  errorMessage?: string;
  raw: unknown;
}

/**
 * Webhook 정규화 결과 — 라우터가 어떤 invoice/payment 를 갱신할지 결정하는 데 사용.
 *  - valid=false: 서명 검증 실패 또는 schema 불일치
 *  - status='unknown': 알 수 없는 상태값 (raw 만 저장하고 skip)
 */
export interface PayssamWebhookParseResult {
  valid: boolean;
  status: "paid" | "cancelled" | "failed" | "refunded" | "unknown";
  providerEventId?: string;
  providerInvoiceId?: string;
  providerPaymentId?: string;
  amountKrw?: number;
  paidAt?: string;
  errorMessage?: string;
  raw: unknown;
}

export interface PayssamProvider {
  createInvoice(input: PayssamCreateInvoiceInput): Promise<PayssamCreateInvoiceResult>;
  /**
   * Webhook 페이로드 + 서명을 정규화된 결과로 변환.
   * 서명 검증은 provider 가 자체 알고리즘으로 수행.
   * Webhook 멱등성은 호출자(라우터) 가 webhook_events 테이블로 보장.
   */
  parsePaymentWebhook(input: PayssamWebhookInput): PayssamWebhookParseResult;
}

export interface PayssamWebhookInput {
  rawBody: string;
  headers: Record<string, string | undefined>;
  payload: unknown;
}

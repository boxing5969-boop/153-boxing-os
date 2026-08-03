// ============================================================
// 결제 어댑터 인터페이스
// ------------------------------------------------------------
// 결제선생(페이민트)/카카오/PG 를 갈아끼우기 위한 추상화.
// AccessDeviceAdapter 와 동일 철학 — 비즈니스 로직은 vendor 를 모른다.
// 결제선생 API 키/명세 수령 후 PayssamProvider 본문만 채우면 라이브.
// ============================================================

export interface PaymentContext {
  base_url: string;
  api_key: string;
  merchant_id?: string;
  dry_run: boolean;
  request_id?: string;
}

export interface CreateBillInput {
  bill_id: string; // 우리 payment_request id (멱등키)
  amount: number; // 원
  member_name: string;
  member_phone: string;
  product_name: string;
  bill_issuer?: string; // 청구서 발급처명
  expire_date?: string; // YYYY-MM-DD
  callback_url: string;
}

export interface CreateBillResult {
  provider: string;
  provider_ref: string; // 청구서 식별자
  payment_link: string; // 회원 결제 링크
  raw?: Record<string, unknown>;
}

export interface CancelInput {
  provider_ref: string;
  amount?: number; // 부분취소 금액(없으면 전액)
  reason?: string;
}

export interface CancelResult {
  provider: string;
  cancelled: boolean;
  raw?: Record<string, unknown>;
}

export type PaymentEventType = "succeeded" | "failed" | "cancelled" | "refunded";

/** 결제선생 → 우리 콜백을 표준 이벤트로 파싱한 결과 */
export interface ParsedCallback {
  provider: string;
  provider_event_id: string | null;
  provider_ref: string | null; // 청구서/요청 식별자
  event_type: PaymentEventType;
  amount: number | null;
  raw: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly name: string;
  createBill(ctx: PaymentContext, input: CreateBillInput): Promise<CreateBillResult>;
  cancel(ctx: PaymentContext, input: CancelInput): Promise<CancelResult>;
  /** 콜백 서명 검증(실패 시 throw). */
  verifyCallback(
    ctx: PaymentContext,
    headers: Record<string, string>,
    rawBody: string
  ): Promise<boolean>;
  parseCallback(rawBody: string, headers: Record<string, string>): ParsedCallback;
}

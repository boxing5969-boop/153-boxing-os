import type {
  PaymentProvider,
  PaymentContext,
  CreateBillInput,
  CreateBillResult,
  CancelInput,
  CancelResult,
  ParsedCallback,
  PaymentEventType,
} from "./types";

// 개발/검증용 목 결제. 실제 돈 이동 없음 — 청구서 링크·이벤트를 흉내낸다.
// 전체 흐름(가입→결제→얼굴→출입)을 로컬에서 끝까지 돌려보기 위한 어댑터.
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";

  async createBill(_ctx: PaymentContext, input: CreateBillInput): Promise<CreateBillResult> {
    const ref = `MOCK-${input.bill_id}`;
    return {
      provider: this.name,
      provider_ref: ref,
      payment_link: `https://mock.pay.local/${ref}`,
      raw: { mock: true, amount: input.amount, product: input.product_name },
    };
  }

  async cancel(_ctx: PaymentContext, input: CancelInput): Promise<CancelResult> {
    return { provider: this.name, cancelled: true, raw: { mock: true, ...input } };
  }

  async verifyCallback(): Promise<boolean> {
    return true;
  }

  parseCallback(rawBody: string): ParsedCallback {
    const b = safeJson(rawBody);
    const status = str(b.status);
    const allowed: PaymentEventType[] = ["succeeded", "failed", "cancelled", "refunded"];
    const event_type: PaymentEventType =
      status && (allowed as string[]).includes(status) ? (status as PaymentEventType) : "succeeded";
    return {
      provider: this.name,
      provider_event_id: str(b.event_id) ?? `mock-${Date.now()}`,
      provider_ref: str(b.bill_id) ?? str(b.provider_ref),
      event_type,
      amount: num(b.amount),
      raw: b,
    };
  }
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}
function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

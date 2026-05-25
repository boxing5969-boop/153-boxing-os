/**
 * Payssam (결제선생) Provider — PLACEHOLDER 구현.
 *
 * ⚠️ TODO (production 진입 전 필수):
 *   1) 결제선생 공식 API 명세 받아서 아래 채우기:
 *      - 실제 baseUrl + path (예: /v1/invoices or /api/payments/request)
 *      - 인증 방식 (Bearer Token / 서명 / 사업자번호+키 등)
 *      - 요청 body 필드명 (현재 amount/customer_name/... 추측)
 *      - 응답 필드명 (현재 id/payment_url 추측)
 *      - webhook 서명 알고리즘 (현재 webhooks/payssam.ts 의 verifyPayssamSignature 도 placeholder)
 *   2) 콜백 URL 등록 — Cloud Run 의 /webhooks/payssam/payment-result
 *   3) Aligo 같은 IP 화이트리스트 필요 여부 확인 → Cloud NAT 정적 IP 등록
 *
 * 내부 비즈니스 로직 (debit→call→refund-on-fail) 은 완성 — 외부 API 만 채우면 됨.
 */
import { loadConfig } from "../config";
import type {
  PayssamCreateInvoiceInput,
  PayssamCreateInvoiceResult,
  PayssamProvider,
} from "./types";

export class RealPayssamProvider implements PayssamProvider {
  constructor(private readonly apiKey: string, private readonly baseUrl: string) {}

  async createInvoice(input: PayssamCreateInvoiceInput): Promise<PayssamCreateInvoiceResult> {
    // TODO: 실 endpoint/path 교체
    const url = `${this.baseUrl.replace(/\/$/, "")}/api/v1/invoices`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // TODO: 실 인증 헤더 (Bearer 가능성 높음. 결제선생 docs 확인)
          Authorization: `Bearer ${this.apiKey}`,
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify({
          // TODO: 실 필드명 (snake_case 가정)
          amount: input.amountKrw,
          customer_name: input.customerName,
          customer_phone: input.customerPhone,
          item_name: input.itemName,
          memo: input.memo,
          callback_url: input.callbackUrl,
        }),
      });
    } catch (err) {
      return {
        ok: false,
        resultCode: "NETWORK_ERROR",
        resultMessage: err instanceof Error ? err.message : "fetch failed",
        raw: { networkError: true },
      };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        resultCode: String(res.status),
        resultMessage: text || `HTTP ${res.status}`,
        raw: { status: res.status, body: text },
      };
    }

    let json: Record<string, unknown>;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      return {
        ok: false,
        resultCode: String(res.status),
        resultMessage: "non-json response",
        raw: { status: res.status },
      };
    }

    return {
      ok: true,
      // TODO: 실 응답 필드명 (id vs invoice_id vs uid 등 docs 확인)
      providerInvoiceId: (json.id as string) ?? (json.invoice_id as string) ?? (json.uid as string),
      paymentUrl: (json.payment_url as string) ?? (json.url as string),
      resultCode: "0",
      resultMessage: "ok",
      raw: json,
    };
  }
}

export class MockPayssamProvider implements PayssamProvider {
  async createInvoice(input: PayssamCreateInvoiceInput): Promise<PayssamCreateInvoiceResult> {
    // amount=0 또는 customerPhone 이 '000' 으로 시작 시 강제 실패
    if (input.amountKrw === 0 || input.customerPhone.startsWith("000")) {
      return {
        ok: false,
        resultCode: "BAD_REQUEST",
        resultMessage: "mock forced failure",
        raw: { mock: true, input },
      };
    }
    return {
      ok: true,
      providerInvoiceId: `mock-inv-${Date.now()}`,
      paymentUrl: `https://mock.payssam.example/pay/${input.idempotencyKey}`,
      resultCode: "0",
      resultMessage: "mock success",
      raw: { mock: true },
    };
  }
}

export function buildPayssamProvider(): PayssamProvider {
  const cfg = loadConfig();
  if (cfg.MOCK_PROVIDERS || cfg.NODE_ENV === "test") {
    return new MockPayssamProvider();
  }
  if (!cfg.PAYSSAM_API_KEY) {
    throw new Error("PAYSSAM_API_KEY required when MOCK_PROVIDERS=false");
  }
  return new RealPayssamProvider(cfg.PAYSSAM_API_KEY, cfg.PAYSSAM_API_BASE_URL);
}

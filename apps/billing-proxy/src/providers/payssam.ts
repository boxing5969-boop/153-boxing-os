/**
 * Payssam (결제선생) Provider — Real (PLACEHOLDER) + Mock.
 *
 * ⚠️ 실 API 명세는 결제선생 docs 받은 후 채워야 함. 현재 RealPayssamProvider 는
 *    실 endpoint/path/필드명/서명 알고리즘 모두 placeholder. 내부 비즈니스 로직
 *    (debit→call→refund + webhook 멱등) 은 완성 — 외부 API 만 교체하면 됨.
 *
 * 보안 원칙:
 *   - API 키는 Authorization 헤더로만 전송, 로그 금지
 *   - Webhook 서명 검증은 PAYSSAM_WEBHOOK_SECRET 사용 (HMAC-SHA256, X-Payssam-Signature)
 *   - 멱등성은 webhook_events.external_event_id UNIQUE 인덱스로 DB 측에서 보장
 *   - 같은 결제 결과 중복 수신 → parsePaymentWebhook 은 정규화만, 라우터가 dedupe
 */
import crypto from "node:crypto";
import { loadConfig } from "../config";
import type {
  PayssamCreateInvoiceInput,
  PayssamCreateInvoiceResult,
  PayssamProvider,
  PayssamWebhookInput,
  PayssamWebhookParseResult,
} from "./types";

// ============================================================
// Real (PLACEHOLDER)
// ============================================================
export class RealPayssamProvider implements PayssamProvider {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly webhookSecret: string | undefined
  ) {
    if (!apiKey) throw new Error("RealPayssamProvider requires apiKey");
    if (!baseUrl) throw new Error("RealPayssamProvider requires baseUrl");
  }

  async createInvoice(input: PayssamCreateInvoiceInput): Promise<PayssamCreateInvoiceResult> {
    // TODO: 결제선생 실 endpoint/path 교체
    const url = `${this.baseUrl.replace(/\/$/, "")}/api/v1/invoices`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // TODO: 실 인증 헤더 — Bearer 가능성 높음
          Authorization: `Bearer ${this.apiKey}`,
          "Idempotency-Key": input.idempotencyKey,
        },
        body: JSON.stringify({
          // TODO: 실 필드명 — docs 받은 후 교체
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
        success: false,
        status: "failed",
        resultCode: "NETWORK_ERROR",
        errorMessage: err instanceof Error ? err.message : "fetch failed",
        raw: { networkError: true },
      };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        success: false,
        status: "failed",
        resultCode: String(res.status),
        errorMessage: text || `HTTP ${res.status}`,
        raw: { status: res.status, body: text },
      };
    }

    let json: Record<string, unknown>;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      return {
        success: false,
        status: "failed",
        resultCode: String(res.status),
        errorMessage: "non-json response",
        raw: { status: res.status },
      };
    }

    // TODO: 실 응답 필드 — id/invoice_id/uid 중 docs 확인 후 정리
    return {
      success: true,
      status: "created",
      providerInvoiceId: (json.id as string) ?? (json.invoice_id as string) ?? (json.uid as string),
      paymentUrl: (json.payment_url as string) ?? (json.url as string),
      resultCode: "0",
      raw: json,
    };
  }

  parsePaymentWebhook(input: PayssamWebhookInput): PayssamWebhookParseResult {
    // 1) 서명 검증 — secret 미설정이면 skip (운영 진입 전 반드시 secret 설정 필요)
    if (this.webhookSecret) {
      const sig = input.headers["x-payssam-signature"] ?? input.headers["X-Payssam-Signature"];
      if (!sig) {
        return { valid: false, status: "unknown", errorMessage: "missing X-Payssam-Signature", raw: input.payload };
      }
      // TODO: 실 알고리즘 확인 후 교체. 가장 흔한 패턴: HMAC-SHA256(secret, rawBody) → hex
      const expected = crypto.createHmac("sha256", this.webhookSecret).update(input.rawBody).digest("hex");
      if (expected.length !== String(sig).length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(sig)))) {
        return { valid: false, status: "unknown", errorMessage: "signature mismatch", raw: input.payload };
      }
    }

    // 2) 스키마 정규화
    return normalizePayssamPayload(input.payload, true);
  }
}

// ============================================================
// Mock
// ============================================================
export class MockPayssamProvider implements PayssamProvider {
  private seq = 0;

  async createInvoice(input: PayssamCreateInvoiceInput): Promise<PayssamCreateInvoiceResult> {
    // amount=0 또는 customerPhone "000" 시작 → 강제 실패 (테스트)
    if (input.amountKrw === 0 || input.customerPhone.startsWith("000")) {
      return {
        success: false,
        status: "failed",
        resultCode: "BAD_REQUEST",
        errorMessage: "mock forced failure",
        raw: { mock: true },
      };
    }
    this.seq++;
    const id = `mock-inv-${this.seq}`;
    return {
      success: true,
      status: "created",
      providerInvoiceId: id,
      paymentUrl: `https://mock.payssam.example/pay/${input.idempotencyKey}`,
      resultCode: "0",
      raw: { mock: true, id, idempotencyKey: input.idempotencyKey },
    };
  }

  parsePaymentWebhook(input: PayssamWebhookInput): PayssamWebhookParseResult {
    // mock 은 서명 검증 skip — 페이로드만 정규화
    return normalizePayssamPayload(input.payload, true);
  }
}

// ============================================================
// 공통 normalization — Real / Mock 둘 다 사용
// ============================================================
function normalizePayssamPayload(payload: unknown, valid: boolean): PayssamWebhookParseResult {
  if (!payload || typeof payload !== "object") {
    return { valid: false, status: "unknown", errorMessage: "payload is not an object", raw: payload };
  }
  const p = payload as Record<string, unknown>;

  // 상태 매핑 — Payssam 실 docs 받기 전 추측 + 흔한 값 커버
  const rawStatus = String(p.status ?? p.payment_status ?? p.state ?? "").toLowerCase();
  let status: PayssamWebhookParseResult["status"] = "unknown";
  if (["paid", "success", "completed", "approved"].includes(rawStatus)) status = "paid";
  else if (["cancelled", "canceled", "voided"].includes(rawStatus)) status = "cancelled";
  else if (["failed", "rejected", "expired"].includes(rawStatus)) status = "failed";
  else if (["refunded"].includes(rawStatus)) status = "refunded";

  const providerEventId = pickString(p, ["event_id", "eventId"]);
  const providerInvoiceId = pickString(p, ["invoice_id", "invoiceId"]);
  const providerPaymentId = pickString(p, ["payment_id", "paymentId", "id"]);
  const amount = pickNumber(p, ["amount", "amount_krw", "amountKrw"]);
  const paidAt = pickString(p, ["paid_at", "paidAt", "completed_at"]);

  return {
    valid,
    status,
    providerEventId,
    providerInvoiceId,
    providerPaymentId,
    amountKrw: amount,
    paidAt,
    raw: payload,
  };
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}
function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (typeof v === "string" && v.length > 0 && !Number.isNaN(Number(v))) return Number(v);
  }
  return undefined;
}

// ============================================================
// Factory
// ============================================================
export function buildPayssamProvider(): PayssamProvider {
  const cfg = loadConfig();
  const mode = resolveProviderMode(cfg);

  if (mode === "mock") {
    return new MockPayssamProvider();
  }

  if (!cfg.PAYSSAM_API_KEY) {
    throw new Error(
      "PROVIDER_MODE=live but PAYSSAM_API_KEY is missing — refuse to start to prevent silent failure"
    );
  }
  if (!cfg.PAYSSAM_API_BASE_URL) {
    throw new Error("PROVIDER_MODE=live but PAYSSAM_API_BASE_URL is missing");
  }
  return new RealPayssamProvider(cfg.PAYSSAM_API_KEY, cfg.PAYSSAM_API_BASE_URL, cfg.PAYSSAM_WEBHOOK_SECRET);
}

function resolveProviderMode(cfg: ReturnType<typeof loadConfig>): "mock" | "live" {
  if (cfg.PROVIDER_MODE) return cfg.PROVIDER_MODE;
  if (cfg.MOCK_PROVIDERS) return "mock";
  if (cfg.NODE_ENV === "test" || cfg.NODE_ENV === "development") return "mock";
  return "live";
}

import type { Env } from "../../lib/env";
import type { PaymentProvider, PaymentContext } from "./types";
import { MockPaymentProvider } from "./mockProvider";
import { PayssamProvider } from "./payssamProvider";

export * from "./types";

/**
 * 환경설정에 따라 결제 어댑터 선택.
 * PAYMENT_PROVIDER=payssam 이면 결제선생, 그 외(기본)는 mock.
 */
export function getPaymentProvider(env: Env): PaymentProvider {
  switch ((env.PAYMENT_PROVIDER ?? "mock").toLowerCase()) {
    case "payssam":
      return new PayssamProvider();
    case "mock":
    default:
      return new MockPaymentProvider();
  }
}

export function getPaymentContext(env: Env): PaymentContext {
  return {
    base_url: env.PAYSSAM_API_URL ?? "",
    api_key: env.PAYSSAM_API_KEY ?? "",
    merchant_id: env.PAYSSAM_MERCHANT_ID,
    // 명시적으로 'false' 일 때만 실발송 — 기본은 안전하게 dry-run
    dry_run: env.PAYMENT_DRY_RUN !== "false",
  };
}

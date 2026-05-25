/**
 * 결제 청구 발행 전체 흐름 — debit → call → log → (실패 시 refund).
 *
 *  1. 단가 조회 (payssam_invoice)
 *  2. wallet 차감 (멱등)
 *  3. service_invoices INSERT (status='requested')
 *  4. Payssam 호출
 *  5. 성공 → status='sent' + provider_invoice_id 저장
 *  6. 실패 → refund + status='failed'
 */
import { logger } from "../lib/logger";
import { getSupabase } from "../lib/supabase";
import { AppError, ProviderError } from "../lib/errors";
import { debitWallet } from "../wallet/debitWallet";
import { refundWallet } from "../wallet/refundWallet";
import { getActivePrice } from "../wallet/getActivePrice";
import { logExternalApiCall } from "../logging/externalApiLog";
import { refundKeyOf } from "../idempotency/makeKey";
import { normalizeKrPhone } from "../validation/phone";
import type { CreateInvoiceInput } from "../validation/schemas";
import type { PayssamProvider } from "../providers/types";
import { buildPayssamProvider } from "../providers/payssam";

export interface CreateInvoiceResult {
  ok: boolean;
  invoiceId: string;
  walletTransactionId: string;
  chargedKrw: number;
  balanceAfterKrw: number;
  providerInvoiceId?: string;
  paymentUrl?: string;
  status: "sent" | "failed" | "draft";
}

interface Deps {
  payssam?: PayssamProvider;
}

const USAGE_TYPE = "payssam_invoice";

export async function createInvoice(
  input: CreateInvoiceInput,
  actorUserId: string | undefined,
  deps: Deps = {}
): Promise<CreateInvoiceResult> {
  const payssam = deps.payssam ?? buildPayssamProvider();
  const supa = getSupabase();
  const log = logger.child({ flow: "createInvoice", tenantId: input.tenant_id, idem: input.idempotency_key });

  const customerPhone = normalizeKrPhone(input.customer_phone);

  // 1) 단가
  const price = await getActivePrice(USAGE_TYPE);
  if (!price) {
    throw new AppError("PRICE_NOT_FOUND", `no active price for usage_type=${USAGE_TYPE}`, 500);
  }

  // 2) wallet 차감 (멱등)
  const debit = await debitWallet({
    tenantId: input.tenant_id,
    usageType: USAGE_TYPE,
    amountKrw: price.chargeKrw,
    idempotencyKey: input.idempotency_key,
    memo: `payssam invoice ${input.amount_krw} KRW`,
  });
  log.info({ debit: { tx: debit.transactionId, balance: debit.balanceAfterKrw, idempotent: debit.idempotent } }, "wallet debited");

  // 3) service_invoices INSERT (멱등 — 같은 idempotency_key 있으면 재사용)
  const existing = await supa
    .from("service_invoices")
    .select("id, status, provider_invoice_id")
    .eq("idempotency_key", input.idempotency_key)
    .maybeSingle();
  if (existing.error) throw new AppError("DB_ERROR", `invoice lookup: ${existing.error.message}`, 500);

  let invoiceId: string;
  if (existing.data) {
    invoiceId = String(existing.data.id);
    if (existing.data.status === "sent" || existing.data.status === "paid") {
      return {
        ok: true,
        invoiceId,
        walletTransactionId: debit.transactionId,
        chargedKrw: price.chargeKrw,
        balanceAfterKrw: debit.balanceAfterKrw,
        providerInvoiceId: existing.data.provider_invoice_id ?? undefined,
        status: "sent",
      };
    }
  } else {
    const ins = await supa
      .from("service_invoices")
      .insert({
        tenant_id: input.tenant_id,
        branch_id: input.branch_id ?? null,
        member_id: input.member_id ?? null,
        provider: "payssam",
        amount_krw: input.amount_krw,
        wallet_charge_krw: price.chargeKrw,
        status: "requested",
        idempotency_key: input.idempotency_key,
        memo: input.memo ?? null,
      })
      .select("id")
      .single();
    if (ins.error || !ins.data) {
      await refundWallet({
        tenantId: input.tenant_id,
        amountKrw: price.chargeKrw,
        idempotencyKey: refundKeyOf(input.idempotency_key),
        memo: "refund: service_invoices insert failed",
      });
      throw new AppError("DB_ERROR", `service_invoices insert: ${ins.error?.message}`, 500);
    }
    invoiceId = String(ins.data.id);
  }

  // 4) Payssam 호출
  const providerRes = await payssam.createInvoice({
    amountKrw: input.amount_krw,
    customerName: input.customer_name,
    customerPhone,
    itemName: input.item_name,
    memo: input.memo,
    idempotencyKey: input.idempotency_key,
  });

  await logExternalApiCall({
    tenantId: input.tenant_id,
    provider: "payssam",
    endpoint: "POST /api/v1/invoices",
    requestId: providerRes.providerInvoiceId,
    status: providerRes.ok ? "success" : "error",
    requestPayload: { amountKrw: input.amount_krw, customerPhone, itemName: input.item_name },
    responsePayload: providerRes.raw,
    errorMessage: providerRes.ok ? undefined : providerRes.resultMessage,
  });

  if (providerRes.ok) {
    await supa
      .from("service_invoices")
      .update({
        status: "sent",
        provider_invoice_id: providerRes.providerInvoiceId ?? null,
      })
      .eq("id", invoiceId);
    return {
      ok: true,
      invoiceId,
      walletTransactionId: debit.transactionId,
      chargedKrw: price.chargeKrw,
      balanceAfterKrw: debit.balanceAfterKrw,
      providerInvoiceId: providerRes.providerInvoiceId,
      paymentUrl: providerRes.paymentUrl,
      status: "sent",
    };
  }

  // 실패 → 환불 + status='failed'
  log.warn({ providerRes }, "payssam invoice create failed — refunding");
  const refund = await refundWallet({
    tenantId: input.tenant_id,
    amountKrw: price.chargeKrw,
    idempotencyKey: refundKeyOf(input.idempotency_key),
    memo: `refund: payssam ${providerRes.resultCode} ${providerRes.resultMessage}`,
  });
  await supa
    .from("service_invoices")
    .update({ status: "failed" })
    .eq("id", invoiceId);

  throw new ProviderError("payssam", `${providerRes.resultCode}: ${providerRes.resultMessage}`, {
    invoiceId,
    refundTransactionId: refund.transactionId,
    balanceAfterKrw: refund.balanceAfterKrw,
  });
}

/**
 * 재사용 가능한 service_invoices job 처리기.
 * 큐된 invoice 를 Payssam 으로 발행 → 결과 따라 status update + 영구 실패 시 환불.
 */
import { logger } from "../lib/logger";
import { getSupabase } from "../lib/supabase";
import { AppError, ValidationError } from "../lib/errors";
import { normalizeKrPhone } from "../validation/phone";
import { buildPayssamProvider } from "../providers/payssam";
import { refundWallet } from "../wallet/refundWallet";
import { logExternalApiCall } from "../logging/externalApiLog";
import { classifyProviderError } from "../lib/retryable";
import type { PayssamProvider } from "../providers/types";
import type { ProcessResult } from "../messages/processMessageJob";

export interface ProcessInvoiceDeps {
  payssam?: PayssamProvider;
}

export async function processInvoiceJob(
  invoiceId: string,
  deps: ProcessInvoiceDeps = {}
): Promise<ProcessResult> {
  const payssam = deps.payssam ?? buildPayssamProvider();
  const supa = getSupabase();
  const log = logger.child({ flow: "processInvoiceJob", invoiceId });

  // 1) invoice + 큐 메타 (memo 에 저장된 customer_*) 로드
  const q = await supa
    .from("service_invoices")
    .select("id, tenant_id, status, amount_krw, wallet_charge_krw, memo, idempotency_key, provider_invoice_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (q.error) throw new AppError("DB_ERROR", `invoice lookup: ${q.error.message}`, 500);
  if (!q.data) throw new ValidationError("invoice not found");

  const inv = q.data as Record<string, unknown>;
  const status = String(inv.status);

  if (status === "sent" || status === "paid" || status === "cancelled") {
    log.info({ status }, "invoice already terminal — skipping");
    return { ok: true, status: "skipped" };
  }

  // bulk orchestrator 가 memo 에 customer 정보 + item 명을 JSON 으로 저장한다고 가정
  // memo 형식: { customer_name?, customer_phone, item_name, memo? } JSON.stringify
  let bundle: { customer_name?: string; customer_phone?: string; item_name?: string; memo?: string };
  try {
    bundle = JSON.parse(String(inv.memo ?? "{}")) as typeof bundle;
  } catch {
    bundle = { memo: String(inv.memo ?? "") };
  }
  if (!bundle.customer_phone || !bundle.item_name) {
    // bulk 호출자가 잘못 저장 — 영구 실패
    const charge = Number(inv.wallet_charge_krw ?? 0);
    if (charge > 0) await refundWallet({ tenantId: String(inv.tenant_id), amountKrw: charge, idempotencyKey: `refund:inv-task:${invoiceId}`, memo: "missing bundle fields" });
    await supa.from("service_invoices").update({ status: "failed", memo: String(inv.memo ?? "") }).eq("id", invoiceId);
    return { ok: false, retryable: false, status: "refunded", reason: "missing bundle fields" };
  }

  const customerPhone = normalizeKrPhone(bundle.customer_phone);

  // 2) Payssam 호출
  const providerRes = await payssam.createInvoice({
    amountKrw: Number(inv.amount_krw),
    customerName: bundle.customer_name,
    customerPhone,
    itemName: bundle.item_name,
    memo: bundle.memo,
    idempotencyKey: String(inv.idempotency_key ?? invoiceId),
  });

  await logExternalApiCall({
    tenantId: String(inv.tenant_id),
    provider: "payssam",
    endpoint: "POST /api/v1/invoices (queued)",
    requestId: providerRes.providerInvoiceId,
    status: providerRes.success ? "success" : "error",
    requestPayload: { amountKrw: inv.amount_krw, customerPhone, itemName: bundle.item_name },
    responsePayload: providerRes.raw,
    errorMessage: providerRes.success ? undefined : providerRes.errorMessage ?? "",
  });

  if (providerRes.success) {
    await supa
      .from("service_invoices")
      .update({ status: "sent", provider_invoice_id: providerRes.providerInvoiceId ?? null })
      .eq("id", invoiceId);
    return { ok: true, status: "sent" };
  }

  const decision = classifyProviderError({
    provider: "payssam",
    resultCode: providerRes.resultCode,
    resultMessage: providerRes.errorMessage ?? "",
  });

  if (decision === "retry") {
    log.warn({ resultCode: providerRes.resultCode }, "invoice transient failure — will retry");
    return { ok: false, retryable: true, status: "failed", reason: providerRes.errorMessage ?? "" };
  }

  // 영구 실패 — 환불 + 'failed'
  const charge = Number(inv.wallet_charge_krw ?? 0);
  if (charge > 0) {
    await refundWallet({
      tenantId: String(inv.tenant_id),
      amountKrw: charge,
      idempotencyKey: `refund:inv-task:${invoiceId}`,
      memo: `refund: payssam ${providerRes.resultCode} ${providerRes.errorMessage ?? ""}`,
    });
  }
  await supa.from("service_invoices").update({ status: "failed" }).eq("id", invoiceId);
  return { ok: false, retryable: false, status: "refunded", reason: providerRes.errorMessage ?? "" };
}

/**
 * 대량 청구서 발송 오케스트레이터.
 *
 * 흐름:
 *  1. 입력 검증 (tenant role)
 *  2. 총 차감액 = invoices.length × unit_charge (payssam_invoice)
 *  3. wallet 1회 차감 (멱등)
 *  4. service_invoices N개 INSERT (status='requested', memo 에 bundle JSON 저장)
 *  5. 각 invoice 큐 enqueue
 *  6. enqueue 실패한 만큼 환불 + status='cancelled'
 */
import { logger } from "../lib/logger";
import { getSupabase } from "../lib/supabase";
import { AppError } from "../lib/errors";
import { debitWallet } from "../wallet/debitWallet";
import { refundWallet } from "../wallet/refundWallet";
import { getActivePrice } from "../wallet/getActivePrice";
import { normalizeKrPhone } from "../validation/phone";
import { refundKeyOf } from "../idempotency/makeKey";
import type { CreateBulkInvoicesInput } from "../validation/schemas";
import type { JobQueue } from "../queue/types";

const USAGE_TYPE = "payssam_invoice";

export interface BulkInvoiceResult {
  ok: boolean;
  total: number;
  enqueued: number;
  failed_to_enqueue: number;
  total_charged_krw: number;
  total_refunded_krw: number;
  balance_after_krw: number;
  walletTransactionId: string;
  invoiceIds: string[];
}

interface Deps {
  queue: JobQueue;
}

export async function createBulkInvoices(
  input: CreateBulkInvoicesInput,
  actorUserId: string | undefined,
  deps: Deps
): Promise<BulkInvoiceResult> {
  const supa = getSupabase();
  const log = logger.child({ flow: "createBulkInvoices", tenantId: input.tenant_id, idem: input.idempotency_key });

  const total = input.invoices.length;
  if (total === 0) {
    throw new AppError("VALIDATION_FAILED", "invoices array is empty", 422);
  }

  const price = await getActivePrice(USAGE_TYPE);
  if (!price) throw new AppError("PRICE_NOT_FOUND", `no active price for ${USAGE_TYPE}`, 500);
  const unitCharge = price.chargeKrw;
  const totalCharge = total * unitCharge;

  // 멱등 wallet 차감
  const debit = await debitWallet({
    tenantId: input.tenant_id,
    usageType: USAGE_TYPE,
    amountKrw: totalCharge,
    idempotencyKey: input.idempotency_key,
    memo: `bulk ${total}건 invoice`,
  });
  log.info({ debit: debit.transactionId, balance: debit.balanceAfterKrw }, "bulk wallet debited");

  // invoice rows — memo 에 bundle JSON 저장 (worker 가 다시 꺼내서 사용)
  const invoiceRows = input.invoices.map((inv, idx) => ({
    tenant_id: input.tenant_id,
    branch_id: inv.branch_id ?? null,
    member_id: inv.member_id ?? null,
    provider: "payssam",
    amount_krw: inv.amount_krw,
    wallet_charge_krw: unitCharge,
    status: "requested",
    idempotency_key: `${input.idempotency_key}-${idx}`,
    memo: JSON.stringify({
      customer_name: inv.customer_name,
      customer_phone: normalizeKrPhone(inv.customer_phone),
      item_name: inv.item_name,
      memo: inv.memo,
    }),
  }));

  let insertedIds: string[];
  const ins = await supa.from("service_invoices").insert(invoiceRows).select("id");
  if (ins.error) {
    if (/duplicate key|uq_service_invoices_idem/i.test(ins.error.message)) {
      const keys = invoiceRows.map((r) => r.idempotency_key);
      const exQ = await supa.from("service_invoices").select("id, idempotency_key").in("idempotency_key", keys);
      if (exQ.error) throw new AppError("DB_ERROR", `bulk recovery: ${exQ.error.message}`, 500);
      const map = new Map(((exQ.data ?? []) as { id: string; idempotency_key: string }[]).map((r) => [r.idempotency_key, r.id]));
      insertedIds = keys.map((k) => map.get(k)).filter((v): v is string => Boolean(v));
      const missing = total - insertedIds.length;
      if (missing > 0) {
        await refundWallet({
          tenantId: input.tenant_id,
          amountKrw: missing * unitCharge,
          idempotencyKey: `${refundKeyOf(input.idempotency_key)}-partial-insert`,
          memo: `bulk inv: ${missing}건 row 생성 실패`,
        });
      }
    } else {
      await refundWallet({
        tenantId: input.tenant_id,
        amountKrw: totalCharge,
        idempotencyKey: `${refundKeyOf(input.idempotency_key)}-insert-failed`,
        memo: "bulk inv: insert failed",
      });
      throw new AppError("DB_ERROR", `bulk insert: ${ins.error.message}`, 500);
    }
  } else {
    insertedIds = ((ins.data ?? []) as { id: string }[]).map((r) => r.id);
  }

  // enqueue
  let enqueued = 0;
  let failedEnqueue = 0;
  for (const invoiceId of insertedIds) {
    try {
      await deps.queue.enqueueInvoiceProcess(invoiceId, { taskName: `inv-${invoiceId}` });
      enqueued++;
    } catch (err) {
      failedEnqueue++;
      log.warn({ invoiceId, err: err instanceof Error ? err.message : err }, "invoice enqueue failed");
      await supa.from("service_invoices").update({ status: "cancelled" }).eq("id", invoiceId);
      await refundWallet({
        tenantId: input.tenant_id,
        amountKrw: unitCharge,
        idempotencyKey: `refund:enqueue:inv:${invoiceId}`,
        memo: "invoice enqueue failed",
      });
    }
  }

  const wQ = await supa.from("service_wallets").select("balance_krw").eq("tenant_id", input.tenant_id).maybeSingle();
  const balanceAfter = wQ.data ? Number((wQ.data as { balance_krw: number }).balance_krw) : 0;

  return {
    ok: true,
    total,
    enqueued,
    failed_to_enqueue: failedEnqueue,
    total_charged_krw: totalCharge,
    total_refunded_krw: failedEnqueue * unitCharge,
    balance_after_krw: balanceAfter,
    walletTransactionId: debit.transactionId,
    invoiceIds: insertedIds,
  };
}

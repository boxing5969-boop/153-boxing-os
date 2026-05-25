/**
 * Payssam (결제선생) 결제 결과 webhook.
 *
 * 처리 순서:
 *  1. webhook_events 에 raw payload 멱등 저장 — 같은 external_event_id 중복 시 즉시 200
 *  2. Provider.parsePaymentWebhook 으로 서명 검증 + 페이로드 정규화
 *  3. invoice 조회 → payments upsert (멱등) → service_invoices status update
 *  4. webhook_events.processed = true → 200 빠르게 반환
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { logger } from "../lib/logger";
import { AppError } from "../lib/errors";
import { getSupabase } from "../lib/supabase";
import { storeWebhookEvent, markWebhookProcessed } from "../webhooks/storeWebhookEvent";
import { buildPayssamProvider } from "../providers/payssam";

export function webhooksPayssamRouter(): Router {
  const r = Router();
  const provider = buildPayssamProvider();

  r.post(
    "/webhooks/payssam/payment-result",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const rawBody: string = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body);

        // 1) parse (서명 검증 + 스키마 정규화)
        const parsed = provider.parsePaymentWebhook({
          rawBody,
          headers: req.headers as Record<string, string | undefined>,
          payload: req.body,
        });

        // 2) raw event 멱등 저장 (signature invalid 라도 저장 — 디버깅 용이성)
        const stored = await storeWebhookEvent({
          provider: "payssam",
          eventType: parsed.status,
          externalEventId: parsed.providerEventId ?? parsed.providerPaymentId ?? parsed.providerInvoiceId,
          payload: req.body,
        });

        // 멱등: 이미 처리됨 → 즉시 200
        if (stored.alreadyExisted && stored.processed) {
          logger.info({ webhookEventId: stored.id }, "payssam webhook duplicate — already processed");
          res.status(200).json({ ok: true, deduplicated: true });
          return;
        }

        // 3) 서명 검증 실패
        if (!parsed.valid) {
          logger.warn({ webhookEventId: stored.id, err: parsed.errorMessage }, "payssam signature/schema invalid");
          res.status(401).json({ ok: false, code: "BAD_SIGNATURE", message: parsed.errorMessage });
          return;
        }

        // 4) unknown 상태 → 라우터가 처리 못함, 그래도 ack (큐 재시도 방지)
        if (parsed.status === "unknown") {
          logger.warn({ webhookEventId: stored.id }, "payssam webhook unknown status — ignored");
          await markWebhookProcessed(stored.id);
          res.status(200).json({ ok: true, ignored: "unknown_status" });
          return;
        }

        // 5) invoice 조회
        const supa = getSupabase();
        type InvoiceRow = { id: string; tenant_id: string; status: string; amount_krw: number; idempotency_key: string | null };
        let invoice: InvoiceRow | null = null;
        if (parsed.providerInvoiceId) {
          const q = await supa
            .from("service_invoices")
            .select("id, tenant_id, status, amount_krw, idempotency_key")
            .eq("provider", "payssam")
            .eq("provider_invoice_id", parsed.providerInvoiceId)
            .maybeSingle();
          if (q.error) throw new AppError("DB_ERROR", `invoice lookup: ${q.error.message}`, 500);
          invoice = (q.data as InvoiceRow | null) ?? null;
        }
        if (!invoice) {
          logger.warn({ webhookEventId: stored.id, parsed }, "payssam webhook: no matching invoice");
          await markWebhookProcessed(stored.id);
          res.status(200).json({ ok: true, ignored: "no_matching_invoice" });
          return;
        }

        // 6) payments upsert (멱등 — provider + provider_payment_id UNIQUE)
        const providerPaymentId = parsed.providerPaymentId ?? parsed.providerEventId;
        if (providerPaymentId) {
          const existsQ = await supa
            .from("payments")
            .select("id")
            .eq("provider", "payssam")
            .eq("provider_payment_id", providerPaymentId)
            .maybeSingle();
          if (existsQ.error) throw new AppError("DB_ERROR", `payments lookup: ${existsQ.error.message}`, 500);

          if (!existsQ.data) {
            const insP = await supa.from("payments").insert({
              tenant_id: invoice.tenant_id,
              invoice_id: invoice.id,
              provider: "payssam",
              provider_payment_id: providerPaymentId,
              amount_krw: parsed.amountKrw ?? invoice.amount_krw,
              status: parsed.status,    // 이미 paid|cancelled|failed|refunded 로 정규화됨
              paid_at: parsed.paidAt ?? new Date().toISOString(),
              raw_payload: req.body,
            });
            if (insP.error && !/duplicate key|uq_payments_provider/i.test(insP.error.message)) {
              throw new AppError("DB_ERROR", `payments insert: ${insP.error.message}`, 500);
            }
          }

          // invoice status update
          const invStatusMap = { paid: "paid", cancelled: "cancelled", failed: "failed", refunded: "cancelled" } as const;
          await supa
            .from("service_invoices")
            .update({ status: invStatusMap[parsed.status], callback_received_at: new Date().toISOString() })
            .eq("id", invoice.id);
        }

        await markWebhookProcessed(stored.id);
        res.status(200).json({ ok: true, status: parsed.status });
      } catch (err) {
        next(err);
      }
    }
  );

  return r;
}

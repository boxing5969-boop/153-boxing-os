/**
 * Payssam (결제선생) 결제 결과 webhook.
 *
 * 처리 순서:
 *  1. raw payload → webhook_events 멱등 저장 (external_event_id 중복 시 즉시 200 반환)
 *  2. 서명 검증 (TODO: 실 알고리즘 적용)
 *  3. invoice 조회 (provider_invoice_id 우선, idempotency_key 보조)
 *  4. payments upsert (멱등 — provider_payment_id 기준)
 *  5. service_invoices.status 업데이트
 *  6. webhook_events.processed = true
 *  7. 200 빠르게 반환 (재시도 트리거 방지)
 */
import crypto from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import { loadConfig } from "../config";
import { logger } from "../lib/logger";
import { AppError } from "../lib/errors";
import { getSupabase } from "../lib/supabase";
import { storeWebhookEvent, markWebhookProcessed } from "../webhooks/storeWebhookEvent";
import { PayssamWebhookSchema } from "../validation/schemas";

/**
 * TODO: 결제선생 공식 docs 의 서명 알고리즘으로 교체.
 * 예시: HMAC-SHA256(secret, raw_body) → hex → X-Payssam-Signature 헤더와 비교
 */
function verifyPayssamSignature(rawBody: string, headerSig: string | undefined, secret: string | undefined): boolean {
  if (!secret) return true; // secret 미설정 시 검증 skip (운영 진입 전 반드시 secret 설정)
  if (!headerSig) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  // 길이 다르면 timing-safe 비교가 throw — 사전 체크
  if (expected.length !== headerSig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(headerSig));
}

export function webhooksPayssamRouter(): Router {
  const r = Router();

  // raw body 필요 — express.json() 적용된 body 와 별도로 raw 보관
  r.post(
    "/webhooks/payssam/payment-result",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const cfg = loadConfig();
        const rawBody: string = (req as Request & { rawBody?: string }).rawBody ?? JSON.stringify(req.body);

        // 1) raw event 저장 (signature 검증 전이라도 디버깅용)
        const parsedSafe = PayssamWebhookSchema.safeParse(req.body);
        const externalEventId =
          (parsedSafe.success ? parsedSafe.data.event_id : undefined) ??
          (parsedSafe.success ? parsedSafe.data.invoice_id : undefined);
        const eventType = parsedSafe.success ? parsedSafe.data.status : undefined;

        const stored = await storeWebhookEvent({
          provider: "payssam",
          eventType,
          externalEventId,
          payload: req.body,
        });

        // 멱등: 이미 처리됐으면 즉시 200
        if (stored.alreadyExisted && stored.processed) {
          logger.info({ webhookEventId: stored.id, externalEventId }, "payssam webhook duplicate — already processed");
          res.status(200).json({ ok: true, deduplicated: true });
          return;
        }

        // 2) 서명 검증
        const sigHeader = req.header("x-payssam-signature");
        if (!verifyPayssamSignature(rawBody, sigHeader, cfg.PAYSSAM_WEBHOOK_SECRET)) {
          logger.warn({ webhookEventId: stored.id }, "payssam signature verification failed");
          res.status(401).json({ ok: false, code: "BAD_SIGNATURE" });
          return;
        }

        // 3) parse
        if (!parsedSafe.success) {
          logger.warn({ webhookEventId: stored.id, issues: parsedSafe.error.issues }, "payssam payload schema mismatch");
          await markWebhookProcessed(stored.id);
          res.status(200).json({ ok: true, ignored: "schema_mismatch" });
          return;
        }
        const payload = parsedSafe.data;

        // 4) invoice 조회
        const supa = getSupabase();
        type InvoiceRow = { id: string; tenant_id: string; status: string; amount_krw: number; idempotency_key: string | null };
        let invoice: InvoiceRow | null = null;
        if (payload.invoice_id) {
          const q = await supa
            .from("service_invoices")
            .select("id, tenant_id, status, amount_krw, idempotency_key")
            .eq("provider", "payssam")
            .eq("provider_invoice_id", payload.invoice_id)
            .maybeSingle();
          if (q.error) throw new AppError("DB_ERROR", `invoice lookup: ${q.error.message}`, 500);
          invoice = (q.data as InvoiceRow | null) ?? null;
        }
        if (!invoice) {
          logger.warn({ webhookEventId: stored.id, payload }, "payssam webhook: no matching invoice");
          await markWebhookProcessed(stored.id);
          res.status(200).json({ ok: true, ignored: "no_matching_invoice" });
          return;
        }

        // 5) status → invoice/payments 매핑
        const lower = payload.status.toLowerCase();
        const isPaid = ["paid", "success", "completed", "approved"].includes(lower);
        const isCancelled = ["cancelled", "canceled", "voided"].includes(lower);
        const isFailed = ["failed", "rejected", "expired"].includes(lower);
        const isRefunded = ["refunded"].includes(lower);

        const providerPaymentId = (req.body as Record<string, unknown>).payment_id as string | undefined
          ?? (req.body as Record<string, unknown>).id as string | undefined
          ?? payload.event_id;

        // 6) payments upsert (멱등)
        const paymentStatus: "paid" | "cancelled" | "failed" | "refunded" | null =
          isPaid ? "paid" : isCancelled ? "cancelled" : isFailed ? "failed" : isRefunded ? "refunded" : null;

        if (paymentStatus && providerPaymentId) {
          // 중복 처리 방지: provider + provider_payment_id UNIQUE 인덱스 활용
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
              amount_krw: payload.amount ?? invoice.amount_krw,
              status: paymentStatus,
              paid_at: payload.paid_at ?? new Date().toISOString(),
              raw_payload: req.body,
            });
            if (insP.error) {
              // race: 다른 동시 webhook 이 같은 id 로 먼저 insert. 무시.
              if (!/duplicate key|uq_payments_provider/i.test(insP.error.message)) {
                throw new AppError("DB_ERROR", `payments insert: ${insP.error.message}`, 500);
              }
            }
          }

          // invoice status update
          const invStatusMap: Record<string, string> = {
            paid: "paid",
            cancelled: "cancelled",
            failed: "failed",
            refunded: "cancelled",
          };
          await supa
            .from("service_invoices")
            .update({ status: invStatusMap[paymentStatus], callback_received_at: new Date().toISOString() })
            .eq("id", invoice.id);
        }

        await markWebhookProcessed(stored.id);
        res.status(200).json({ ok: true });
      } catch (err) {
        next(err);
      }
    }
  );

  return r;
}

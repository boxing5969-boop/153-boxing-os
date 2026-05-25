/**
 * Cloud Tasks 컨슈머: message_jobs 큐 처리.
 *
 * 흐름:
 *  1. INTERNAL_TASK_SECRET 검증
 *  2. message_job 조회 (status='queued' 또는 'pending')
 *  3. 잠금: 'processing' 으로 update (낙관)
 *  4. Aligo 발송
 *  5. 결과에 따라 status update + 실패 시 refund (idempotency 키 = `task:${jobId}`)
 *  6. 200 반환
 *
 * 멱등: 같은 job 을 두 번 호출해도 안전 (status 가 이미 sent/refunded 면 no-op).
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { logger } from "../lib/logger";
import { AppError, ProviderError, ValidationError } from "../lib/errors";
import { getSupabase } from "../lib/supabase";
import { verifyInternalTask } from "../auth/verifyInternalTask";
import { ProcessMessageTaskSchema } from "../validation/schemas";
import { normalizeKrPhone } from "../validation/phone";
import { buildAligoProvider } from "../providers/aligo";
import { refundWallet } from "../wallet/refundWallet";
import { logExternalApiCall } from "../logging/externalApiLog";
import type { AligoProvider } from "../providers/types";

interface Deps {
  aligo?: AligoProvider;
}

export function tasksMessagesRouter(deps: Deps = {}): Router {
  const r = Router();

  r.post(
    "/tasks/messages/process",
    verifyInternalTask,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const parsed = ProcessMessageTaskSchema.safeParse(req.body);
        if (!parsed.success) throw new ValidationError("invalid task payload", parsed.error.issues);

        const { message_job_id } = parsed.data;
        const supa = getSupabase();
        const log = logger.child({ flow: "taskMessage", jobId: message_job_id });

        // 1) job 조회
        const jobQ = await supa
          .from("message_jobs")
          .select("id, company_id, status, recipient_phone, content, message_type, payload, sender_id, idempotency_key, wallet_charge_krw")
          .eq("id", message_job_id)
          .maybeSingle();
        if (jobQ.error) throw new AppError("DB_ERROR", `job lookup: ${jobQ.error.message}`, 500);
        if (!jobQ.data) throw new ValidationError("job not found");

        const job = jobQ.data as Record<string, unknown>;
        const status = String(job.status);

        // 이미 처리됨 → no-op
        if (status === "sent" || status === "refunded" || status === "cancelled") {
          res.json({ ok: true, status, deduplicated: true });
          return;
        }

        // 2) 낙관적 잠금: queued/pending → processing
        const lock = await supa
          .from("message_jobs")
          .update({ status: "processing" })
          .eq("id", message_job_id)
          .in("status", ["pending", "queued", "retry"])
          .select("id")
          .maybeSingle();
        if (lock.error) throw new AppError("DB_ERROR", `lock: ${lock.error.message}`, 500);
        if (!lock.data && status !== "processing") {
          // 다른 워커가 가져감
          res.json({ ok: true, status, contended: true });
          return;
        }

        // 3) 발신번호 결정 (payload.sender 에 저장됨)
        const payload = (job.payload as Record<string, unknown>) ?? {};
        const sender = payload.sender ? normalizeKrPhone(String(payload.sender)) : "";
        const recipient = normalizeKrPhone(String(job.recipient_phone));
        const content = String(job.content ?? payload.content ?? "");
        const msgTypeLower = String(job.message_type ?? "sms").toLowerCase();
        const msgType = (msgTypeLower === "mms" ? "MMS" : msgTypeLower === "lms" ? "LMS" : "SMS") as "SMS" | "LMS" | "MMS";

        if (!sender) throw new ValidationError("job missing sender (payload.sender)");

        // 4) Aligo 호출
        const aligo = deps.aligo ?? buildAligoProvider();
        const providerRes = await aligo.sendMessage({ sender, receiver: recipient, msg: content, msgType });

        await logExternalApiCall({
          tenantId: String(job.company_id),
          provider: "aligo",
          endpoint: "POST https://apis.aligo.in/send/ (task)",
          requestId: providerRes.providerMessageId,
          status: providerRes.ok ? "success" : "error",
          requestPayload: { sender, receiver: recipient, msgType, contentLength: content.length },
          responsePayload: providerRes.raw,
          errorMessage: providerRes.ok ? undefined : providerRes.resultMessage,
        });

        if (providerRes.ok) {
          await supa.from("message_logs").insert({
            tenant_id: job.company_id,
            message_job_id,
            provider: "aligo",
            provider_message_id: providerRes.providerMessageId ?? null,
            recipient_phone: recipient,
            message_type: msgTypeLower,
            status: "sent",
            response_payload: providerRes.raw,
            sent_at: new Date().toISOString(),
          });
          await supa
            .from("message_jobs")
            .update({ status: "sent", processed_at: new Date().toISOString() })
            .eq("id", message_job_id);
          res.json({ ok: true, status: "sent", provider_message_id: providerRes.providerMessageId });
          return;
        }

        // 실패 → refund (이미 debit 된 wallet_charge_krw 가 있다면)
        log.warn({ providerRes }, "task aligo send failed");
        const charge = Number(job.wallet_charge_krw ?? 0);
        let refundResult: { transactionId: string; balanceAfterKrw: number } | null = null;
        if (charge > 0) {
          const refund = await refundWallet({
            tenantId: String(job.company_id),
            amountKrw: charge,
            idempotencyKey: `refund:task:${message_job_id}`,
            memo: `refund: task aligo ${providerRes.resultCode} ${providerRes.resultMessage}`,
          });
          refundResult = { transactionId: refund.transactionId, balanceAfterKrw: refund.balanceAfterKrw };
        }
        await supa.from("message_logs").insert({
          tenant_id: job.company_id,
          message_job_id,
          provider: "aligo",
          recipient_phone: recipient,
          message_type: msgTypeLower,
          status: "failed",
          response_payload: providerRes.raw,
          error_message: `${providerRes.resultCode}: ${providerRes.resultMessage}`,
        });
        await supa
          .from("message_jobs")
          .update({ status: "refunded", processed_at: new Date().toISOString() })
          .eq("id", message_job_id);

        throw new ProviderError("aligo", `${providerRes.resultCode}: ${providerRes.resultMessage}`, {
          messageJobId: message_job_id,
          refund: refundResult,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return r;
}

/**
 * 재사용 가능한 message job 처리기.
 * - /tasks/messages/process (Cloud Tasks 콜백) 와 LocalImmediateQueue 양쪽에서 호출
 * - DB 에서 job 로드 → Aligo 호출 → 결과에 따라 status update + 실패 시 환불
 * - 멱등: 이미 sent/refunded/cancelled 인 job 은 no-op
 *
 * 반환값:
 *   { ok: true }                          → 성공 (큐는 ack)
 *   { ok: false, retryable: true }        → 일시 실패 (큐는 재시도)
 *   { ok: false, retryable: false }       → 영구 실패 (이미 환불됨, 큐는 ack)
 */
import { logger } from "../lib/logger";
import { getSupabase } from "../lib/supabase";
import { AppError, ValidationError } from "../lib/errors";
import { normalizeKrPhone } from "../validation/phone";
import { buildAligoProvider } from "../providers/aligo";
import { refundWallet } from "../wallet/refundWallet";
import { logExternalApiCall } from "../logging/externalApiLog";
import { classifyProviderError } from "../lib/retryable";
import type { AligoProvider } from "../providers/types";

export interface ProcessResult {
  ok: boolean;
  retryable?: boolean;
  status: "sent" | "refunded" | "failed" | "skipped";
  reason?: string;
}

export interface ProcessMessageDeps {
  aligo?: AligoProvider;
}

export async function processMessageJob(
  jobId: string,
  deps: ProcessMessageDeps = {}
): Promise<ProcessResult> {
  const aligo = deps.aligo ?? buildAligoProvider();
  const supa = getSupabase();
  const log = logger.child({ flow: "processMessageJob", jobId });

  // 1) job 로드
  const jobQ = await supa
    .from("message_jobs")
    .select("id, company_id, status, recipient_phone, content, message_type, payload, sender_id, idempotency_key, wallet_charge_krw, retry_count")
    .eq("id", jobId)
    .maybeSingle();
  if (jobQ.error) throw new AppError("DB_ERROR", `job lookup: ${jobQ.error.message}`, 500);
  if (!jobQ.data) {
    throw new ValidationError("job not found");
  }

  const job = jobQ.data as Record<string, unknown>;
  const status = String(job.status);

  // 2) 이미 처리됨 → no-op (멱등)
  if (status === "sent" || status === "refunded" || status === "cancelled") {
    log.info({ status }, "job already terminal — skipping");
    return { ok: true, status: "skipped" };
  }

  // 3) processing 잠금 (낙관적)
  const lock = await supa
    .from("message_jobs")
    .update({ status: "processing" })
    .eq("id", jobId)
    .in("status", ["pending", "queued", "retry"])
    .select("id")
    .maybeSingle();
  if (lock.error) throw new AppError("DB_ERROR", `lock: ${lock.error.message}`, 500);
  if (!lock.data && status !== "processing") {
    // 다른 워커가 가져감
    log.info({ status }, "job contended by another worker");
    return { ok: true, status: "skipped" };
  }

  // 4) 데이터 추출
  const payload = (job.payload as Record<string, unknown>) ?? {};
  const sender = payload.sender ? normalizeKrPhone(String(payload.sender)) : "";
  const recipient = normalizeKrPhone(String(job.recipient_phone));
  const content = String(job.content ?? payload.content ?? "");
  const msgTypeLower = String(job.message_type ?? "sms").toLowerCase();
  const msgType = (msgTypeLower === "mms" ? "MMS" : msgTypeLower === "lms" ? "LMS" : "SMS") as "SMS" | "LMS" | "MMS";
  const charge = Number(job.wallet_charge_krw ?? 0);

  if (!sender) {
    // 발신번호 누락은 영구 실패
    await markFailed(supa, jobId, "missing sender");
    if (charge > 0) await refundWallet({ tenantId: String(job.company_id), amountKrw: charge, idempotencyKey: `refund:task:${jobId}`, memo: "missing sender" });
    return { ok: false, retryable: false, status: "refunded", reason: "missing sender" };
  }

  // 5) Aligo 호출 — 타입별 분기
  const title = msgType !== "SMS" ? content.slice(0, 30) : undefined;
  const providerRes = await (
    msgType === "SMS"
      ? aligo.sendSms({ sender, receiver: recipient, msg: content })
      : msgType === "LMS"
      ? aligo.sendLms({ sender, receiver: recipient, msg: content, title })
      : aligo.sendMms({ sender, receiver: recipient, msg: content, title })
  );

  await logExternalApiCall({
    tenantId: String(job.company_id),
    provider: "aligo",
    endpoint: `POST aligo ${msgType} (queued)`,
    requestId: providerRes.providerMessageId,
    status: providerRes.success ? "success" : "error",
    requestPayload: { sender, receiverMasked: recipient.slice(0, 3) + "****" + recipient.slice(-4), msgType, contentLength: content.length, attempt: Number(job.retry_count ?? 0) + 1 },
    responsePayload: providerRes.raw,
    errorMessage: providerRes.success ? undefined : providerRes.errorMessage,
  });

  if (providerRes.success) {
    await supa.from("message_logs").insert({
      tenant_id: job.company_id,
      message_job_id: jobId,
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
      .eq("id", jobId);
    return { ok: true, status: "sent" };
  }

  // 6) 실패 분류
  const decision = classifyProviderError({
    provider: "aligo",
    resultCode: providerRes.resultCode,
    resultMessage: providerRes.errorMessage,
  });

  // 항상 log 적재
  await supa.from("message_logs").insert({
    tenant_id: job.company_id,
    message_job_id: jobId,
    provider: "aligo",
    recipient_phone: recipient,
    message_type: msgTypeLower,
    status: decision === "retry" ? "retry" : "failed",
    response_payload: providerRes.raw,
    error_message: `${providerRes.resultCode}: ${providerRes.errorMessage ?? ""}`,
  });

  if (decision === "retry") {
    // 재시도 가능 — status 를 'retry' 로 되돌리고 retry_count 증가. Cloud Tasks 가 자동 재시도.
    await supa
      .from("message_jobs")
      .update({ status: "retry", retry_count: Number(job.retry_count ?? 0) + 1 })
      .eq("id", jobId);
    log.warn({ resultCode: providerRes.resultCode }, "transient failure — will retry");
    return { ok: false, retryable: true, status: "failed", reason: providerRes.errorMessage };
  }

  // 영구 실패 — 환불 처리 + status='refunded'
  log.warn({ resultCode: providerRes.resultCode }, "permanent failure — refunding");
  if (charge > 0) {
    await refundWallet({
      tenantId: String(job.company_id),
      amountKrw: charge,
      idempotencyKey: `refund:task:${jobId}`,
      memo: `refund: aligo ${providerRes.resultCode} ${providerRes.errorMessage ?? ""}`,
    });
  }
  await supa
    .from("message_jobs")
    .update({ status: "refunded", processed_at: new Date().toISOString() })
    .eq("id", jobId);
  return { ok: false, retryable: false, status: "refunded", reason: providerRes.errorMessage };
}

async function markFailed(supa: ReturnType<typeof getSupabase>, jobId: string, reason: string): Promise<void> {
  await supa
    .from("message_jobs")
    .update({ status: "refunded", processed_at: new Date().toISOString(), error_message: reason })
    .eq("id", jobId);
}

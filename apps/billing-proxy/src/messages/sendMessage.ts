/**
 * 메시지 발송 전체 흐름 — debit → call → log → (실패 시 refund).
 *
 * 비즈니스 규칙:
 *  1. 단가 조회 (active price)
 *  2. wallet 차감 (멱등)
 *  3. message_job INSERT (status='processing')
 *  4. 발신번호 결정: sender_id 가 있으면 message_senders 조회, 없으면 ALIGO_SENDER_DEFAULT
 *  5. marketing 카테고리: consent + opt-out 검사, 자동 광고 prefix/suffix
 *  6. 제공자 호출 (Aligo)
 *  7. 성공 → message_logs(sent) + message_jobs.status='sent'
 *  8. 실패 → refund + message_logs(failed) + message_jobs.status='refunded'
 *  9. 모든 경로에 external_api_logs 적재
 */
import { loadConfig } from "../config";
import { logger } from "../lib/logger";
import { getSupabase } from "../lib/supabase";
import { AppError, ProviderError, ValidationError } from "../lib/errors";
import { debitWallet } from "../wallet/debitWallet";
import { refundWallet } from "../wallet/refundWallet";
import { getActivePrice } from "../wallet/getActivePrice";
import { logExternalApiCall } from "../logging/externalApiLog";
import { refundKeyOf } from "../idempotency/makeKey";
import { normalizeKrPhone, calcKrBytes } from "../validation/phone";
import type { SendMessageInput } from "../validation/schemas";
import type { AligoProvider } from "../providers/types";
import { buildAligoProvider } from "../providers/aligo";

export interface SendMessageResult {
  ok: boolean;
  messageJobId: string;
  walletTransactionId: string;
  chargedKrw: number;
  balanceAfterKrw: number;
  providerMessageId?: string;
  status: "sent" | "refunded" | "failed";
  resultMessage?: string;
}

interface Deps {
  aligo?: AligoProvider;
}

/**
 * 발신번호 조회: sender_id 가 있으면 message_senders 에서, 없으면 환경변수 기본값.
 * approved 상태 아닌 발신번호는 사용 거부.
 */
async function resolveSender(
  tenantId: string,
  senderId: string | undefined
): Promise<string> {
  const cfg = loadConfig();
  if (senderId) {
    const supa = getSupabase();
    const { data, error } = await supa
      .from("message_senders")
      .select("sender_number, status, tenant_id")
      .eq("id", senderId)
      .maybeSingle();
    if (error) throw new AppError("DB_ERROR", `message_senders lookup: ${error.message}`, 500);
    if (!data) throw new ValidationError("sender_id not found");
    if (data.tenant_id !== tenantId) throw new ValidationError("sender_id does not belong to this tenant");
    if (data.status !== "approved") {
      throw new ValidationError(`sender not approved (status=${data.status})`);
    }
    return normalizeKrPhone(data.sender_number);
  }
  if (!cfg.ALIGO_SENDER_DEFAULT) {
    throw new ValidationError("no sender_id and no ALIGO_SENDER_DEFAULT configured");
  }
  return normalizeKrPhone(cfg.ALIGO_SENDER_DEFAULT);
}

/**
 * marketing 카테고리 사전 검사 — 동의 + 수신거부.
 * 위반 시 ValidationError throw (wallet 차감 전이라 환불 불필요).
 */
async function assertMarketingAllowed(tenantId: string, phone: string): Promise<void> {
  const supa = getSupabase();
  const [optOut, consent] = await Promise.all([
    supa.from("message_opt_outs").select("id").eq("tenant_id", tenantId).eq("phone", phone).maybeSingle(),
    supa.from("message_consents").select("marketing_allowed").eq("tenant_id", tenantId).eq("phone", phone).maybeSingle(),
  ]);
  if (optOut.error) throw new AppError("DB_ERROR", `opt_outs: ${optOut.error.message}`, 500);
  if (consent.error) throw new AppError("DB_ERROR", `consents: ${consent.error.message}`, 500);
  if (optOut.data) throw new ValidationError("recipient opted out of all messages");
  if (!consent.data || !consent.data.marketing_allowed) {
    throw new ValidationError("recipient has not consented to marketing messages");
  }
}

/** 광고성 메시지에 (광고) prefix + 무료수신거부 안내 suffix 자동 부착 (없으면). */
function applyMarketingFormatting(content: string): string {
  let out = content;
  if (!/^\(광고\)/.test(out.trim())) {
    out = `(광고) ${out}`;
  }
  if (!/무료수신거부|080[\s-]*\d{3,4}[\s-]*\d{4}/.test(out)) {
    out = `${out}\n무료수신거부 080-XXX-XXXX`;
  }
  return out;
}

/** msg_type 결정: 명시 우선, 자동 보정 (90 byte 초과 시 LMS 강제). */
function decideMsgType(declared: "sms" | "lms" | "mms", content: string): "SMS" | "LMS" | "MMS" {
  if (declared === "mms") return "MMS";
  const bytes = calcKrBytes(content);
  if (declared === "sms" && bytes <= 90) return "SMS";
  return "LMS";
}

export async function sendMessage(
  input: SendMessageInput,
  actorUserId: string | undefined,
  deps: Deps = {}
): Promise<SendMessageResult> {
  const aligo = deps.aligo ?? buildAligoProvider();
  const supa = getSupabase();
  const log = logger.child({ flow: "sendMessage", tenantId: input.tenant_id, idem: input.idempotency_key });

  // 1) 수신번호 정규화
  const recipient = normalizeKrPhone(input.recipient_phone);

  // 2) marketing 검사
  if (input.category === "marketing") {
    await assertMarketingAllowed(input.tenant_id, recipient);
  }

  // 3) 발신번호
  const sender = await resolveSender(input.tenant_id, input.sender_id);

  // 4) 본문 + 타입
  const finalContent = input.category === "marketing" ? applyMarketingFormatting(input.content) : input.content;
  const msgType = decideMsgType(input.message_type, finalContent);

  // 5) 단가
  const usageType = msgType.toLowerCase() as "sms" | "lms" | "mms";
  const price = await getActivePrice(usageType);
  if (!price) {
    throw new AppError("PRICE_NOT_FOUND", `no active price for usage_type=${usageType}`, 500);
  }

  // 6) wallet 차감 (멱등)
  const debit = await debitWallet({
    tenantId: input.tenant_id,
    usageType,
    amountKrw: price.chargeKrw,
    idempotencyKey: input.idempotency_key,
    memo: `aligo ${msgType} to ${recipient.slice(0, 4)}****`,
  });
  log.info({ debit: { tx: debit.transactionId, balance: debit.balanceAfterKrw, idempotent: debit.idempotent } }, "wallet debited");

  // 7) message_job INSERT (status=processing)
  //    멱등: 같은 idempotency_key 로 job 이 이미 있으면 그것 사용
  const existingJob = await supa
    .from("message_jobs")
    .select("id, status")
    .eq("idempotency_key", input.idempotency_key)
    .maybeSingle();
  if (existingJob.error) throw new AppError("DB_ERROR", `job lookup: ${existingJob.error.message}`, 500);

  let messageJobId: string;
  if (existingJob.data) {
    messageJobId = String(existingJob.data.id);
    // 이미 sent/refunded 면 같은 결과 그대로 반환
    if (existingJob.data.status === "sent") {
      return {
        ok: true,
        messageJobId,
        walletTransactionId: debit.transactionId,
        chargedKrw: price.chargeKrw,
        balanceAfterKrw: debit.balanceAfterKrw,
        status: "sent",
        resultMessage: "already sent (idempotent)",
      };
    }
    if (existingJob.data.status === "refunded") {
      return {
        ok: false,
        messageJobId,
        walletTransactionId: debit.transactionId,
        chargedKrw: price.chargeKrw,
        balanceAfterKrw: debit.balanceAfterKrw,
        status: "refunded",
        resultMessage: "already refunded (idempotent)",
      };
    }
  } else {
    const ins = await supa
      .from("message_jobs")
      .insert({
        company_id: input.tenant_id,             // 기존 컬럼명 (tenant_id alias)
        branch_id: input.branch_id ?? null,
        member_id: input.member_id ?? null,
        lead_id: input.lead_id ?? null,
        sender_id: input.sender_id ?? null,
        provider: "aligo",
        channel: "sms",                          // 기존 enum
        message_type: usageType,
        category: input.category,
        recipient_phone: recipient,
        content: finalContent,
        wallet_charge_krw: price.chargeKrw,
        status: "processing",
        idempotency_key: input.idempotency_key,
        scheduled_at: new Date().toISOString(),
        payload: { content: finalContent, usageType, sender },
      })
      .select("id")
      .single();
    if (ins.error || !ins.data) {
      // 차감했는데 job 못 만들었음 → 환불
      await refundWallet({
        tenantId: input.tenant_id,
        amountKrw: price.chargeKrw,
        idempotencyKey: refundKeyOf(input.idempotency_key),
        memo: `refund: message_jobs insert failed`,
      });
      throw new AppError("DB_ERROR", `message_jobs insert: ${ins.error?.message}`, 500);
    }
    messageJobId = String(ins.data.id);
  }

  // 8) Aligo 호출
  const providerRes = await aligo.sendMessage({
    sender,
    receiver: recipient,
    msg: finalContent,
    msgType,
    title: msgType !== "SMS" ? input.content.slice(0, 30) : undefined,
  });

  // external_api_logs 기록 (best-effort)
  await logExternalApiCall({
    tenantId: input.tenant_id,
    provider: "aligo",
    endpoint: "POST https://apis.aligo.in/send/",
    requestId: providerRes.providerMessageId,
    status: providerRes.ok ? "success" : "error",
    requestPayload: { sender, receiver: recipient, msgType, contentLength: finalContent.length },
    responsePayload: providerRes.raw,
    errorMessage: providerRes.ok ? undefined : providerRes.resultMessage,
  });

  // 9) 결과 분기
  if (providerRes.ok) {
    await supa.from("message_logs").insert({
      tenant_id: input.tenant_id,
      message_job_id: messageJobId,
      provider: "aligo",
      provider_message_id: providerRes.providerMessageId ?? null,
      recipient_phone: recipient,
      message_type: usageType,
      status: "sent",
      response_payload: providerRes.raw,
      sent_at: new Date().toISOString(),
    });
    await supa
      .from("message_jobs")
      .update({ status: "sent", processed_at: new Date().toISOString() })
      .eq("id", messageJobId);
    return {
      ok: true,
      messageJobId,
      walletTransactionId: debit.transactionId,
      chargedKrw: price.chargeKrw,
      balanceAfterKrw: debit.balanceAfterKrw,
      providerMessageId: providerRes.providerMessageId,
      status: "sent",
      resultMessage: providerRes.resultMessage,
    };
  }

  // 실패 → 환불 + 로그
  log.warn({ providerRes }, "aligo send failed — refunding");
  const refund = await refundWallet({
    tenantId: input.tenant_id,
    amountKrw: price.chargeKrw,
    idempotencyKey: refundKeyOf(input.idempotency_key),
    memo: `refund: aligo ${providerRes.resultCode} ${providerRes.resultMessage}`,
  });
  await supa.from("message_logs").insert({
    tenant_id: input.tenant_id,
    message_job_id: messageJobId,
    provider: "aligo",
    recipient_phone: recipient,
    message_type: usageType,
    status: "failed",
    response_payload: providerRes.raw,
    error_message: `${providerRes.resultCode}: ${providerRes.resultMessage}`,
  });
  await supa
    .from("message_jobs")
    .update({ status: "refunded", processed_at: new Date().toISOString() })
    .eq("id", messageJobId);

  // 비-네트워크 결정적 실패는 502 로 표현 (라우트에서 변환)
  throw new ProviderError("aligo", `${providerRes.resultCode}: ${providerRes.resultMessage}`, {
    messageJobId,
    refundTransactionId: refund.transactionId,
    balanceAfterKrw: refund.balanceAfterKrw,
  });
}

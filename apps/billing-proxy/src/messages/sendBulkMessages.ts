/**
 * 대량 메시지 발송 오케스트레이터.
 *
 * 흐름:
 *  1. 입력 검증 (tenant role, sender approved)
 *  2. 수신자 각각 정규화 + marketing 동의/거부 검사 → eligible / blocked 분리
 *  3. 단가 조회 → total_charge = eligible_count × unit_charge
 *  4. wallet 1회 일괄 차감 (bulk idempotency key)
 *  5. message_jobs N개 INSERT (status='queued', 각 job 의 wallet_charge_krw = unit)
 *  6. 각 job 큐에 enqueue
 *  7. enqueue 전체 실패 시 total 환불 (실 외부 호출 전이라 안전)
 *  8. 일부 enqueue 실패 시 그 부분만 환불
 *  9. summary 반환 (total/eligible/blocked/enqueued/refunded)
 *
 * 멱등: 같은 bulk idempotency_key 재호출 시 기존 차감 transaction 반환 + 큐는 ALREADY_EXISTS 처리
 */
import { logger } from "../lib/logger";
import { getSupabase } from "../lib/supabase";
import { AppError, ValidationError } from "../lib/errors";
import { debitWallet } from "../wallet/debitWallet";
import { refundWallet } from "../wallet/refundWallet";
import { getActivePrice } from "../wallet/getActivePrice";
import { normalizeKrPhone, calcKrBytes } from "../validation/phone";
import { refundKeyOf } from "../idempotency/makeKey";
import type { SendBulkMessagesInput } from "../validation/schemas";
import type { JobQueue } from "../queue/types";

export interface BulkMessageResult {
  ok: boolean;
  total: number;
  eligible: number;
  blocked: { phone: string; reason: string }[];
  enqueued: number;
  failed_to_enqueue: number;
  total_charged_krw: number;
  total_refunded_krw: number;
  balance_after_krw: number;
  walletTransactionId: string;
  jobIds: string[];
}

interface Deps {
  queue: JobQueue;
}

function decideMsgType(declared: "sms" | "lms" | "mms", content: string): "sms" | "lms" | "mms" {
  if (declared === "mms") return "mms";
  const bytes = calcKrBytes(content);
  if (declared === "sms" && bytes <= 90) return "sms";
  return "lms";
}

function applyMarketingFormatting(content: string): string {
  let out = content;
  if (!/^\(광고\)/.test(out.trim())) out = `(광고) ${out}`;
  if (!/무료수신거부|080[\s-]*\d{3,4}[\s-]*\d{4}/.test(out)) {
    out = `${out}\n무료수신거부 080-XXX-XXXX`;
  }
  return out;
}

export async function sendBulkMessages(
  input: SendBulkMessagesInput,
  actorUserId: string | undefined,
  deps: Deps
): Promise<BulkMessageResult> {
  const supa = getSupabase();
  const log = logger.child({ flow: "sendBulkMessages", tenantId: input.tenant_id, idem: input.idempotency_key });

  // sender 조회
  const senderQ = await supa
    .from("message_senders")
    .select("id, sender_number, status, tenant_id")
    .eq("id", input.sender_id)
    .maybeSingle();
  if (senderQ.error) throw new AppError("DB_ERROR", `sender lookup: ${senderQ.error.message}`, 500);
  if (!senderQ.data) throw new ValidationError("sender_id not found");
  const senderRow = senderQ.data as { sender_number: string; status: string; tenant_id: string };
  if (senderRow.tenant_id !== input.tenant_id) throw new ValidationError("sender does not belong to tenant");
  if (senderRow.status !== "approved") throw new ValidationError(`sender not approved (${senderRow.status})`);
  const senderNumber = normalizeKrPhone(senderRow.sender_number);

  // 본문 + 타입
  const finalContent = input.category === "marketing" ? applyMarketingFormatting(input.content) : input.content;
  const msgType = decideMsgType(input.message_type, finalContent);

  // 단가
  const price = await getActivePrice(msgType);
  if (!price) throw new AppError("PRICE_NOT_FOUND", `no active price for ${msgType}`, 500);
  const unitCharge = price.chargeKrw;

  // 수신자 정규화 + (marketing) 동의/거부 검사
  const normalized: string[] = [];
  const blocked: { phone: string; reason: string }[] = [];
  for (const raw of input.recipients) {
    try {
      normalized.push(normalizeKrPhone(raw));
    } catch (e) {
      blocked.push({ phone: raw, reason: e instanceof Error ? e.message : "invalid phone" });
    }
  }

  if (input.category === "marketing" && normalized.length > 0) {
    const [optOuts, consents] = await Promise.all([
      supa.from("message_opt_outs").select("phone").eq("tenant_id", input.tenant_id).in("phone", normalized),
      supa.from("message_consents").select("phone, marketing_allowed").eq("tenant_id", input.tenant_id).in("phone", normalized),
    ]);
    if (optOuts.error) throw new AppError("DB_ERROR", optOuts.error.message, 500);
    if (consents.error) throw new AppError("DB_ERROR", consents.error.message, 500);
    const optOutSet = new Set(((optOuts.data ?? []) as { phone: string }[]).map((r) => r.phone));
    const consentMap = new Map(((consents.data ?? []) as { phone: string; marketing_allowed: boolean }[]).map((r) => [r.phone, r.marketing_allowed]));
    const eligible: string[] = [];
    for (const phone of normalized) {
      if (optOutSet.has(phone)) {
        blocked.push({ phone, reason: "opted out" });
        continue;
      }
      if (!consentMap.get(phone)) {
        blocked.push({ phone, reason: "no marketing consent" });
        continue;
      }
      eligible.push(phone);
    }
    normalized.length = 0;
    normalized.push(...eligible);
  }

  const eligibleCount = normalized.length;
  const totalCharge = eligibleCount * unitCharge;
  log.info({ total: input.recipients.length, eligible: eligibleCount, blocked: blocked.length, unitCharge, totalCharge }, "bulk prepared");

  if (eligibleCount === 0) {
    return {
      ok: true,
      total: input.recipients.length,
      eligible: 0,
      blocked,
      enqueued: 0,
      failed_to_enqueue: 0,
      total_charged_krw: 0,
      total_refunded_krw: 0,
      balance_after_krw: 0,
      walletTransactionId: "",
      jobIds: [],
    };
  }

  // 일괄 wallet 차감 (멱등)
  const debit = await debitWallet({
    tenantId: input.tenant_id,
    usageType: msgType,
    amountKrw: totalCharge,
    idempotencyKey: input.idempotency_key,
    memo: `bulk ${eligibleCount}건 ${msgType.toUpperCase()}`,
  });

  // message_jobs N 개 insert — 각각 unit 만큼 wallet_charge_krw 표시 (refund 계산용)
  const jobRows = normalized.map((phone, idx) => ({
    company_id: input.tenant_id,
    branch_id: input.branch_id ?? null,
    sender_id: input.sender_id,
    provider: "aligo",
    channel: "sms",
    message_type: msgType,
    category: input.category,
    recipient_phone: phone,
    content: finalContent,
    wallet_charge_krw: unitCharge,
    status: "queued",
    idempotency_key: `${input.idempotency_key}-${idx}`,
    scheduled_at: new Date().toISOString(),
    payload: { content: finalContent, usageType: msgType, sender: senderNumber },
  }));

  // 멱등: 같은 bulk_idempotency_key + idx 가 이미 있으면 기존 row 사용
  let insertedIds: string[];
  const ins = await supa.from("message_jobs").insert(jobRows).select("id");
  if (ins.error) {
    // 일부/전부가 unique violation 인 경우 — 기존 row 조회로 복구
    if (/duplicate key|uq_message_jobs_idem/i.test(ins.error.message)) {
      const keys = jobRows.map((r) => r.idempotency_key);
      const exQ = await supa.from("message_jobs").select("id, idempotency_key").in("idempotency_key", keys);
      if (exQ.error) throw new AppError("DB_ERROR", `bulk recovery: ${exQ.error.message}`, 500);
      const map = new Map(((exQ.data ?? []) as { id: string; idempotency_key: string }[]).map((r) => [r.idempotency_key, r.id]));
      insertedIds = keys.map((k) => map.get(k)).filter((v): v is string => Boolean(v));
      if (insertedIds.length !== eligibleCount) {
        // 차감했는데 job 못 만든 부분이 있음 → 그 차이 환불
        const missing = eligibleCount - insertedIds.length;
        if (missing > 0) {
          await refundWallet({
            tenantId: input.tenant_id,
            amountKrw: missing * unitCharge,
            idempotencyKey: `${refundKeyOf(input.idempotency_key)}-partial-insert`,
            memo: `bulk: ${missing}건 job 생성 실패`,
          });
        }
      }
    } else {
      // 완전 실패 — 전체 환불
      await refundWallet({
        tenantId: input.tenant_id,
        amountKrw: totalCharge,
        idempotencyKey: `${refundKeyOf(input.idempotency_key)}-insert-failed`,
        memo: "bulk: message_jobs insert failed",
      });
      throw new AppError("DB_ERROR", `bulk insert: ${ins.error.message}`, 500);
    }
  } else {
    insertedIds = ((ins.data ?? []) as { id: string }[]).map((r) => r.id);
  }

  // 큐 enqueue — 실패한 만큼 환불
  let enqueued = 0;
  let failedEnqueue = 0;
  for (const jobId of insertedIds) {
    try {
      await deps.queue.enqueueMessageProcess(jobId, { taskName: `msg-${jobId}` });
      enqueued++;
    } catch (err) {
      failedEnqueue++;
      log.warn({ jobId, err: err instanceof Error ? err.message : err }, "enqueue failed for job");
      // 그 job 만 환불 + cancelled
      await supa.from("message_jobs").update({ status: "cancelled", error_message: "enqueue failed" }).eq("id", jobId);
      await refundWallet({
        tenantId: input.tenant_id,
        amountKrw: unitCharge,
        idempotencyKey: `refund:enqueue:${jobId}`,
        memo: "enqueue failed",
      });
    }
  }

  // 잔액 재조회
  const wQ = await supa.from("service_wallets").select("balance_krw").eq("tenant_id", input.tenant_id).maybeSingle();
  const balanceAfter = wQ.data ? Number((wQ.data as { balance_krw: number }).balance_krw) : 0;

  return {
    ok: true,
    total: input.recipients.length,
    eligible: eligibleCount,
    blocked,
    enqueued,
    failed_to_enqueue: failedEnqueue,
    total_charged_krw: totalCharge,
    total_refunded_krw: failedEnqueue * unitCharge,
    balance_after_krw: balanceAfter,
    walletTransactionId: debit.transactionId,
    jobIds: insertedIds,
  };
}

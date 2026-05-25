/**
 * 모든 엔드포인트 요청 zod 스키마.
 */
import { z } from "zod";

const UUID = z.string().uuid();
const NonEmpty = z.string().min(1);
const IdempotencyKey = z.string().min(8).max(128).regex(/^[A-Za-z0-9_\-:.]+$/);

export const SendMessageSchema = z.object({
  tenant_id: UUID,
  branch_id: UUID.optional(),
  member_id: UUID.optional(),
  lead_id: UUID.optional(),
  sender_id: UUID.optional(),
  recipient_phone: NonEmpty,
  message_type: z.enum(["sms", "lms", "mms"]),
  category: z.enum(["informational", "marketing"]),
  content: z.string().min(1).max(2000),
  idempotency_key: IdempotencyKey,
});
export type SendMessageInput = z.infer<typeof SendMessageSchema>;

export const CreateInvoiceSchema = z.object({
  tenant_id: UUID,
  branch_id: UUID.optional(),
  member_id: UUID.optional(),
  amount_krw: z.number().int().positive().max(100_000_000),
  customer_name: NonEmpty.optional(),
  customer_phone: NonEmpty,
  item_name: NonEmpty.max(200),
  memo: z.string().max(500).optional(),
  idempotency_key: IdempotencyKey,
});
export type CreateInvoiceInput = z.infer<typeof CreateInvoiceSchema>;

export const ProcessMessageTaskSchema = z.object({
  message_job_id: UUID,
});
export type ProcessMessageTaskInput = z.infer<typeof ProcessMessageTaskSchema>;

export const ProcessInvoiceTaskSchema = z.object({
  message_job_id: UUID,  // bulk worker 통일 — invoice id 를 같은 키로
});
export type ProcessInvoiceTaskInput = z.infer<typeof ProcessInvoiceTaskSchema>;

export const SendBulkMessagesSchema = z.object({
  tenant_id: UUID,
  branch_id: UUID.optional(),
  sender_id: UUID,
  recipients: z.array(NonEmpty).min(1).max(5000),
  message_type: z.enum(["sms", "lms", "mms"]),
  category: z.enum(["informational", "marketing"]),
  content: z.string().min(1).max(2000),
  idempotency_key: IdempotencyKey,
});
export type SendBulkMessagesInput = z.infer<typeof SendBulkMessagesSchema>;

export const CreateBulkInvoicesSchema = z.object({
  tenant_id: UUID,
  invoices: z.array(z.object({
    branch_id: UUID.optional(),
    member_id: UUID.optional(),
    amount_krw: z.number().int().positive().max(100_000_000),
    customer_name: NonEmpty.optional(),
    customer_phone: NonEmpty,
    item_name: NonEmpty.max(200),
    memo: z.string().max(500).optional(),
  })).min(1).max(1000),
  idempotency_key: IdempotencyKey,
});
export type CreateBulkInvoicesInput = z.infer<typeof CreateBulkInvoicesSchema>;

/** Payssam webhook payload — 실제 docs 받기 전 placeholder. */
export const PayssamWebhookSchema = z.object({
  event_id: z.string().optional(),
  invoice_id: z.string().optional(),
  status: z.string(),
  amount: z.number().optional(),
  paid_at: z.string().optional(),
}).passthrough();
export type PayssamWebhookPayload = z.infer<typeof PayssamWebhookSchema>;

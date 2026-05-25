/**
 * B2B SaaS Billing / Messaging 클라이언트.
 *
 * - 외부 API 직접 호출 금지: 모든 유료 작업은 Cloud Run billing-proxy 경유.
 * - 읽기 전용 데이터 (wallet 잔액, 거래내역, 사용량 통계 등) 는 Supabase 직접 (RLS 가 격리).
 */
import { supabase } from "@/integrations/supabase/client";
import { getAuthHeaders } from "./api";

const BILLING_PROXY_URL = (import.meta.env.VITE_BILLING_PROXY_URL as string) ?? "";

function ensureProxyUrl(): string {
  if (!BILLING_PROXY_URL) {
    throw new Error("VITE_BILLING_PROXY_URL 환경변수가 설정되지 않았습니다");
  }
  return BILLING_PROXY_URL.replace(/\/$/, "");
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${ensureProxyUrl()}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (json.message as string) ?? `HTTP ${res.status}`;
    const err = new Error(msg) as Error & { code?: string; details?: unknown };
    err.code = json.code as string | undefined;
    err.details = json.details;
    throw err;
  }
  return json as T;
}

// ============================================================
// Wallet (Supabase 직접)
// ============================================================
export interface ServiceWallet {
  id: string;
  tenant_id: string;
  balance_krw: number;
  status: string;
  updated_at: string;
}

export interface ServiceWalletTransaction {
  id: string;
  tenant_id: string;
  wallet_id: string;
  type: "charge" | "debit" | "refund" | "adjustment";
  usage_type: string | null;
  amount_krw: number;
  balance_after_krw: number;
  external_ref: string | null;
  memo: string | null;
  created_at: string;
}

export async function getWallet(tenantId: string): Promise<ServiceWallet | null> {
  const { data, error } = await supabase
    .from("service_wallets")
    .select("id, tenant_id, balance_krw, status, updated_at")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ServiceWallet | null) ?? null;
}

export async function listWalletTransactions(
  tenantId: string,
  limit = 30
): Promise<ServiceWalletTransaction[]> {
  const { data, error } = await supabase
    .from("service_wallet_transactions")
    .select(
      "id, tenant_id, wallet_id, type, usage_type, amount_krw, balance_after_krw, external_ref, memo, created_at"
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data as ServiceWalletTransaction[]) ?? [];
}

// ============================================================
// Usage Pricing (Supabase 직접 — 글로벌, RLS는 is_active만)
// ============================================================
export interface UsagePrice {
  usage_type: string;
  cost_krw: number;
  charge_krw: number;
}

export async function listActivePrices(): Promise<UsagePrice[]> {
  const { data, error } = await supabase
    .from("usage_price_rules")
    .select("usage_type, cost_krw, charge_krw")
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  return (data as UsagePrice[]) ?? [];
}

// ============================================================
// Messages (send → Cloud Run / list → Supabase)
// ============================================================
export interface SendMessageBody {
  tenant_id: string;
  branch_id?: string;
  member_id?: string;
  lead_id?: string;
  sender_id?: string;
  recipient_phone: string;
  message_type: "sms" | "lms" | "mms";
  category: "informational" | "marketing";
  content: string;
  idempotency_key: string;
}

export interface SendMessageResponse {
  ok: boolean;
  message_job_id: string;
  wallet_transaction_id: string;
  charged_krw: number;
  balance_after_krw: number;
  provider_message_id?: string;
  status: "sent" | "refunded" | "failed";
  message?: string;
}

export function sendMessage(body: SendMessageBody): Promise<SendMessageResponse> {
  return postJson<SendMessageResponse>("/api/messages/send", body);
}

export interface MessageSender {
  id: string;
  sender_number: string;
  status: string;
}
export async function listSenders(tenantId: string): Promise<MessageSender[]> {
  const { data, error } = await supabase
    .from("message_senders")
    .select("id, sender_number, status")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as MessageSender[]) ?? [];
}

export interface RecentMessageLog {
  id: string;
  message_job_id: string | null;
  recipient_phone: string | null;
  message_type: string | null;
  status: string | null;
  error_message: string | null;
  created_at: string;
}
export async function listRecentMessageLogs(tenantId: string, limit = 20): Promise<RecentMessageLog[]> {
  const { data, error } = await supabase
    .from("message_logs")
    .select("id, message_job_id, recipient_phone, message_type, status, error_message, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data as RecentMessageLog[]) ?? [];
}

// ============================================================
// Message templates (Supabase 직접 — RLS 처리)
// ============================================================
export interface MessageTemplateB2B {
  id: string;
  tenant_id: string | null;
  name: string;
  content: string;
  category: "informational" | "marketing" | null;
  message_type: "sms" | "lms" | "mms" | null;
  is_active: boolean;
  updated_at: string;
}

export async function listMessageTemplates(tenantId: string): Promise<MessageTemplateB2B[]> {
  const { data, error } = await supabase
    .from("message_templates")
    .select("id, tenant_id, name, content, category, message_type, is_active, updated_at")
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as MessageTemplateB2B[]) ?? [];
}

export async function upsertMessageTemplate(input: {
  id?: string;
  tenant_id: string;
  branch_id?: string;
  name: string;
  content: string;
  category: "informational" | "marketing";
  message_type: "sms" | "lms" | "mms";
  is_active: boolean;
}): Promise<MessageTemplateB2B> {
  const row = {
    id: input.id,
    tenant_id: input.tenant_id,
    branch_id: input.branch_id ?? null,
    name: input.name,
    content: input.content,
    category: input.category,
    message_type: input.message_type,
    channel: "sms",        // 기존 호환
    is_active: input.is_active,
  };
  const { data, error } = await supabase.from("message_templates").upsert(row).select("*").single();
  if (error) throw new Error(error.message);
  return data as unknown as MessageTemplateB2B;
}

// ============================================================
// Service Invoices (create → Cloud Run / list → Supabase)
// ============================================================
export interface CreateInvoiceBody {
  tenant_id: string;
  branch_id?: string;
  member_id?: string;
  amount_krw: number;
  customer_name?: string;
  customer_phone: string;
  item_name: string;
  memo?: string;
  idempotency_key: string;
}

export interface CreateInvoiceResponse {
  ok: boolean;
  invoice_id: string;
  wallet_transaction_id: string;
  charged_krw: number;
  balance_after_krw: number;
  provider_invoice_id?: string;
  payment_url?: string;
  status: "sent" | "failed" | "draft";
}

export function createInvoice(body: CreateInvoiceBody): Promise<CreateInvoiceResponse> {
  return postJson<CreateInvoiceResponse>("/api/invoices/create", body);
}

export interface ServiceInvoice {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  member_id: string | null;
  provider: string;
  provider_invoice_id: string | null;
  amount_krw: number;
  wallet_charge_krw: number;
  status: "draft" | "requested" | "sent" | "paid" | "failed" | "cancelled";
  callback_received_at: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

export async function listServiceInvoices(
  tenantId: string,
  opts: { status?: string; limit?: number } = {}
): Promise<ServiceInvoice[]> {
  let q = supabase
    .from("service_invoices")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data as unknown as ServiceInvoice[]) ?? [];
}

// ============================================================
// Integration accounts (Supabase 직접)
// ============================================================
export interface IntegrationAccount {
  id: string;
  tenant_id: string;
  provider: "payssam" | "aligo" | "kt_call_assistant";
  account_label: string | null;
  status: "active" | "inactive" | "error";
  config: Record<string, unknown> | null;
  updated_at: string;
}

export async function listIntegrationAccounts(tenantId: string): Promise<IntegrationAccount[]> {
  const { data, error } = await supabase
    .from("integration_accounts")
    .select("id, tenant_id, provider, account_label, status, config, updated_at")
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
  return (data as IntegrationAccount[]) ?? [];
}

// ============================================================
// HQ usage summary (Supabase — HQ only RLS)
// ============================================================
export interface TenantUsageRow {
  tenant_id: string;
  tenant_name: string;
  balance_krw: number;
  monthly_charged_krw: number;
  monthly_refunded_krw: number;
  message_count: number;
  invoice_count: number;
  status: string;
}

/**
 * 본사 전체 tenant 사용량 — HQ admin RLS 통과 시에만 데이터 반환.
 * 단순 집계 (월말 마감 RPC 는 Phase 20G).
 */
export async function listTenantsForHq(): Promise<TenantUsageRow[]> {
  const { data: companies, error } = await supabase
    .from("companies")
    .select("id, name, status");
  if (error) throw new Error(error.message);
  if (!companies) return [];

  const ids = (companies as unknown as { id: string }[]).map((c) => c.id);
  const { data: wallets } = await supabase
    .from("service_wallets")
    .select("tenant_id, balance_krw")
    .in("tenant_id", ids);
  const walletRows = (wallets ?? []) as unknown as Array<{ tenant_id: string; balance_krw: number }>;
  const walletMap = new Map<string, number>(walletRows.map((w) => [w.tenant_id, w.balance_krw]));

  // 단순 집계 — Phase 20G 에서 hq_margin_monthly 로 교체
  return (companies as unknown as { id: string; name: string; status: string }[]).map((c) => ({
    tenant_id: c.id,
    tenant_name: c.name,
    balance_krw: walletMap.get(c.id) ?? 0,
    monthly_charged_krw: 0,
    monthly_refunded_krw: 0,
    message_count: 0,
    invoice_count: 0,
    status: c.status,
  }));
}

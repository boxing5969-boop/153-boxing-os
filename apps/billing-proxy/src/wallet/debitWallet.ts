/**
 * debit_service_wallet RPC 호출 래퍼.
 * - service_role 만 호출 가능 (DB 측 GRANT)
 * - 멱등: 같은 idempotency_key 재호출 시 기존 transaction 반환
 * - 잔액 부족 시 WalletError(INSUFFICIENT_BALANCE)
 */
import { getSupabase } from "../lib/supabase";
import { WalletError } from "../lib/errors";

export interface DebitWalletInput {
  tenantId: string;
  usageType: string;
  amountKrw: number;
  idempotencyKey: string;
  memo?: string;
}

export interface DebitWalletResult {
  transactionId: string;
  walletId: string;
  amountKrw: number;          // 음수 (debit)
  balanceAfterKrw: number;
  idempotent: boolean;        // 동일 키로 재호출되어 기존 row 반환된 경우 true
}

/**
 * @throws WalletError on insufficient balance or wallet not found/suspended
 */
export async function debitWallet(input: DebitWalletInput): Promise<DebitWalletResult> {
  const supa = getSupabase();
  const { data, error } = await supa.rpc("debit_service_wallet", {
    p_tenant_id: input.tenantId,
    p_usage_type: input.usageType,
    p_amount_krw: input.amountKrw,
    p_idempotency_key: input.idempotencyKey,
    p_memo: input.memo ?? null,
  });

  if (error) {
    // Postgres ERRCODE 매핑
    const msg = error.message || "";
    if (/insufficient balance/i.test(msg)) {
      throw new WalletError("INSUFFICIENT_BALANCE", msg);
    }
    if (/wallet not found/i.test(msg)) {
      throw new WalletError("WALLET_NOT_FOUND", msg);
    }
    if (/wallet (status )?is suspended|wallet status is/i.test(msg)) {
      throw new WalletError("WALLET_SUSPENDED", msg);
    }
    throw new WalletError("WALLET_ERROR", msg);
  }

  if (!data) {
    throw new WalletError("WALLET_ERROR", "debit returned no row");
  }

  // RPC 가 record 1개 반환 — Supabase JS 는 단일 record 도 다양한 모양으로 줄 수 있음
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new WalletError("WALLET_ERROR", "debit returned malformed row");
  }

  const tx = row as Record<string, unknown>;
  // 멱등 재호출 여부 추정: created_at 이 1초 이상 이전이면 기존 row
  const createdAt = typeof tx.created_at === "string" ? new Date(tx.created_at).getTime() : Date.now();
  const idempotent = Date.now() - createdAt > 1000;

  return {
    transactionId: String(tx.id),
    walletId: String(tx.wallet_id),
    amountKrw: Number(tx.amount_krw),
    balanceAfterKrw: Number(tx.balance_after_krw),
    idempotent,
  };
}

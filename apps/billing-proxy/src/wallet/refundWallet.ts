/**
 * refund_service_wallet RPC 호출 래퍼.
 * 멱등 — 같은 idempotency_key 재호출 시 기존 row 반환.
 */
import { getSupabase } from "../lib/supabase";
import { WalletError } from "../lib/errors";

export interface RefundWalletInput {
  tenantId: string;
  amountKrw: number;
  idempotencyKey: string;
  memo?: string;
}

export interface RefundWalletResult {
  transactionId: string;
  walletId: string;
  amountKrw: number;
  balanceAfterKrw: number;
}

/**
 * 외부 API 실패 후 wallet 복원.
 * @throws WalletError
 */
export async function refundWallet(input: RefundWalletInput): Promise<RefundWalletResult> {
  const supa = getSupabase();
  const { data, error } = await supa.rpc("refund_service_wallet", {
    p_tenant_id: input.tenantId,
    p_amount_krw: input.amountKrw,
    p_idempotency_key: input.idempotencyKey,
    p_memo: input.memo ?? null,
  });
  if (error) {
    throw new WalletError("WALLET_ERROR", `refund failed: ${error.message}`);
  }
  if (!data) {
    throw new WalletError("WALLET_ERROR", "refund returned no row");
  }
  const row = Array.isArray(data) ? data[0] : data;
  const tx = row as Record<string, unknown>;
  return {
    transactionId: String(tx.id),
    walletId: String(tx.wallet_id),
    amountKrw: Number(tx.amount_krw),
    balanceAfterKrw: Number(tx.balance_after_krw),
  };
}

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearSupabase, injectSupabase, makeMockSupabase, setupTestEnv } from "./_mocks";
import { debitWallet } from "../src/wallet/debitWallet";
import { refundWallet } from "../src/wallet/refundWallet";
import { getActivePrice } from "../src/wallet/getActivePrice";
import { WalletError } from "../src/lib/errors";

describe("wallet RPCs", () => {
  beforeEach(() => setupTestEnv());
  afterEach(() => clearSupabase());

  describe("debitWallet", () => {
    it("success — returns transaction row", async () => {
      injectSupabase(
        makeMockSupabase({
          rpc: {
            debit_service_wallet: (args) => {
              expect(args.p_tenant_id).toBe("11111111-1111-1111-1111-111111111111");
              expect(args.p_usage_type).toBe("sms");
              expect(args.p_amount_krw).toBe(12);
              return {
                data: {
                  id: "tx-1",
                  wallet_id: "wallet-1",
                  amount_krw: -12,
                  balance_after_krw: 9988,
                  created_at: new Date().toISOString(),
                },
                error: null,
              };
            },
          },
        })
      );
      const r = await debitWallet({
        tenantId: "11111111-1111-1111-1111-111111111111",
        usageType: "sms",
        amountKrw: 12,
        idempotencyKey: "idem-abc-1234",
      });
      expect(r.transactionId).toBe("tx-1");
      expect(r.amountKrw).toBe(-12);
      expect(r.balanceAfterKrw).toBe(9988);
      expect(r.idempotent).toBe(false);
    });

    it("insufficient balance → WalletError(INSUFFICIENT_BALANCE)", async () => {
      injectSupabase(
        makeMockSupabase({
          rpc: {
            debit_service_wallet: () => ({
              data: null,
              error: { message: "insufficient balance: have 5 need 12" },
            }),
          },
        })
      );
      await expect(
        debitWallet({
          tenantId: "11111111-1111-1111-1111-111111111111",
          usageType: "sms",
          amountKrw: 12,
          idempotencyKey: "idem-low-bal-9",
        })
      ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    });

    it("wallet not found → WalletError(WALLET_NOT_FOUND)", async () => {
      injectSupabase(
        makeMockSupabase({
          rpc: {
            debit_service_wallet: () => ({
              data: null,
              error: { message: "wallet not found for tenant ..." },
            }),
          },
        })
      );
      await expect(
        debitWallet({
          tenantId: "22222222-2222-2222-2222-222222222222",
          usageType: "sms",
          amountKrw: 12,
          idempotencyKey: "idem-notfound-1",
        })
      ).rejects.toBeInstanceOf(WalletError);
    });

    it("idempotent re-call returns same row (created_at >1s ago)", async () => {
      const oldCreated = new Date(Date.now() - 5_000).toISOString();
      injectSupabase(
        makeMockSupabase({
          rpc: {
            debit_service_wallet: () => ({
              data: {
                id: "tx-existing",
                wallet_id: "wallet-1",
                amount_krw: -12,
                balance_after_krw: 9988,
                created_at: oldCreated,
              },
              error: null,
            }),
          },
        })
      );
      const r = await debitWallet({
        tenantId: "11111111-1111-1111-1111-111111111111",
        usageType: "sms",
        amountKrw: 12,
        idempotencyKey: "idem-repeated",
      });
      expect(r.transactionId).toBe("tx-existing");
      expect(r.idempotent).toBe(true);
    });
  });

  describe("refundWallet", () => {
    it("success", async () => {
      injectSupabase(
        makeMockSupabase({
          rpc: {
            refund_service_wallet: (args) => {
              expect(args.p_amount_krw).toBe(12);
              return {
                data: {
                  id: "rf-1",
                  wallet_id: "wallet-1",
                  amount_krw: 12,
                  balance_after_krw: 10000,
                  created_at: new Date().toISOString(),
                },
                error: null,
              };
            },
          },
        })
      );
      const r = await refundWallet({
        tenantId: "11111111-1111-1111-1111-111111111111",
        amountKrw: 12,
        idempotencyKey: "refund:idem-abc",
      });
      expect(r.transactionId).toBe("rf-1");
      expect(r.balanceAfterKrw).toBe(10000);
    });
  });

  describe("getActivePrice", () => {
    it("returns row when active", async () => {
      injectSupabase(
        makeMockSupabase({
          rpc: {
            get_active_usage_price: () => ({
              data: [{ usage_type: "sms", cost_krw: 9, charge_krw: 12 }],
              error: null,
            }),
          },
        })
      );
      const p = await getActivePrice("sms");
      expect(p).toEqual({ usageType: "sms", costKrw: 9, chargeKrw: 12 });
    });

    it("returns null when no active row", async () => {
      injectSupabase(
        makeMockSupabase({
          rpc: { get_active_usage_price: () => ({ data: null, error: null }) },
        })
      );
      const p = await getActivePrice("nonexistent");
      expect(p).toBeNull();
    });
  });
});

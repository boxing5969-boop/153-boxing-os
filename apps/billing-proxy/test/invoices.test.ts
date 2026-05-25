import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearSupabase, injectSupabase, makeMockSupabase, setupTestEnv } from "./_mocks";
import { createInvoice } from "../src/invoices/createInvoice";
import { MockPayssamProvider } from "../src/providers/payssam";
import type { PayssamCreateInvoiceInput, PayssamCreateInvoiceResult, PayssamProvider } from "../src/providers/types";
import type { CreateInvoiceInput } from "../src/validation/schemas";
import { ProviderError } from "../src/lib/errors";

const TENANT = "11111111-1111-1111-1111-111111111111";

function baseInput(): CreateInvoiceInput {
  return {
    tenant_id: TENANT,
    amount_krw: 50_000,
    customer_phone: "010-1234-5678",
    item_name: "Boxing 1개월",
    idempotency_key: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  };
}

interface State {
  walletBalance: number;
  refundCalls: number;
  invoiceUpdates: Array<{ status: string }>;
}

function makeStatefulSupabase(state: State) {
  return makeMockSupabase({
    rpc: {
      get_active_usage_price: (args) => {
        if (args.p_usage_type === "payssam_invoice") {
          return { data: [{ usage_type: "payssam_invoice", cost_krw: 55, charge_krw: 80 }], error: null };
        }
        return { data: null, error: null };
      },
      debit_service_wallet: (args) => {
        const amt = Number(args.p_amount_krw);
        if (state.walletBalance < amt) {
          return { data: null, error: { message: `insufficient balance: have ${state.walletBalance} need ${amt}` } };
        }
        state.walletBalance -= amt;
        return {
          data: {
            id: "tx-debit-inv",
            wallet_id: "w-1",
            amount_krw: -amt,
            balance_after_krw: state.walletBalance,
            created_at: new Date().toISOString(),
          },
          error: null,
        };
      },
      refund_service_wallet: (args) => {
        state.refundCalls++;
        state.walletBalance += Number(args.p_amount_krw);
        return {
          data: {
            id: "tx-refund-inv",
            wallet_id: "w-1",
            amount_krw: Number(args.p_amount_krw),
            balance_after_krw: state.walletBalance,
            created_at: new Date().toISOString(),
          },
          error: null,
        };
      },
    },
    table: ({ tableName, op, payload }) => {
      if (tableName === "service_invoices" && op === "insert") {
        return { data: { id: "invoice-1" }, error: null };
      }
      if (tableName === "service_invoices" && op === "update") {
        state.invoiceUpdates.push({ status: String((payload as { status?: string })?.status ?? "") });
        return { data: null, error: null };
      }
      if (tableName === "service_invoices" && op === "select") {
        return { data: null, error: null };  // 기존 invoice 없음
      }
      return { data: null, error: null };
    },
  });
}

describe("createInvoice", () => {
  beforeEach(() => setupTestEnv());
  afterEach(() => clearSupabase());

  it("success — Payssam OK → invoice status='sent'", async () => {
    const state: State = { walletBalance: 1000, refundCalls: 0, invoiceUpdates: [] };
    injectSupabase(makeStatefulSupabase(state));
    const payssam = new MockPayssamProvider();
    const r = await createInvoice(baseInput(), "user-1", { payssam });
    expect(r.ok).toBe(true);
    expect(r.status).toBe("sent");
    expect(r.chargedKrw).toBe(80);
    expect(r.balanceAfterKrw).toBe(920);
    expect(r.providerInvoiceId).toMatch(/^mock-inv-/);
    expect(state.refundCalls).toBe(0);
    expect(state.invoiceUpdates).toContainEqual({ status: "sent" });
  });

  it("failure — Payssam error → wallet refunded + invoice status='failed' + ProviderError", async () => {
    const state: State = { walletBalance: 1000, refundCalls: 0, invoiceUpdates: [] };
    injectSupabase(makeStatefulSupabase(state));

    const failingPayssam: PayssamProvider = {
      async createInvoice(_input: PayssamCreateInvoiceInput): Promise<PayssamCreateInvoiceResult> {
        return { ok: false, resultCode: "500", resultMessage: "provider down", raw: {} };
      },
    };

    await expect(createInvoice(baseInput(), "user-1", { payssam: failingPayssam })).rejects.toBeInstanceOf(ProviderError);
    expect(state.refundCalls).toBe(1);
    expect(state.walletBalance).toBe(1000);
    expect(state.invoiceUpdates).toContainEqual({ status: "failed" });
  });
});

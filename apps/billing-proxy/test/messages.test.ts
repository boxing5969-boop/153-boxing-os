import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSupabase, injectSupabase, makeMockSupabase, setupTestEnv } from "./_mocks";
import { sendMessage } from "../src/messages/sendMessage";
import { MockAligoProvider } from "../src/providers/aligo";
import type { AligoProvider, AligoSendInput, AligoSendResult } from "../src/providers/types";
import type { SendMessageInput } from "../src/validation/schemas";
import { ProviderError } from "../src/lib/errors";

const TENANT = "11111111-1111-1111-1111-111111111111";

function baseInput(): SendMessageInput {
  return {
    tenant_id: TENANT,
    recipient_phone: "010-1234-5678",
    message_type: "sms",
    category: "informational",
    content: "안녕하세요 153복싱짐입니다",
    idempotency_key: `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  };
}

interface State {
  walletBalance: number;
  debitCalls: number;
  refundCalls: number;
  inserts: Array<{ table: string; payload: unknown }>;
}

function makeStatefulSupabase(state: State) {
  return makeMockSupabase({
    rpc: {
      get_active_usage_price: (args) => {
        const t = String(args.p_usage_type);
        const map: Record<string, { cost_krw: number; charge_krw: number }> = {
          sms: { cost_krw: 9, charge_krw: 12 },
          lms: { cost_krw: 26, charge_krw: 39 },
          mms: { cost_krw: 60, charge_krw: 90 },
        };
        const r = map[t];
        return r ? { data: [{ usage_type: t, ...r }], error: null } : { data: null, error: null };
      },
      debit_service_wallet: (args) => {
        state.debitCalls++;
        const amt = Number(args.p_amount_krw);
        if (state.walletBalance < amt) {
          return { data: null, error: { message: `insufficient balance: have ${state.walletBalance} need ${amt}` } };
        }
        state.walletBalance -= amt;
        return {
          data: {
            id: `tx-debit-${state.debitCalls}`,
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
        const amt = Number(args.p_amount_krw);
        state.walletBalance += amt;
        return {
          data: {
            id: `tx-refund-${state.refundCalls}`,
            wallet_id: "w-1",
            amount_krw: amt,
            balance_after_krw: state.walletBalance,
            created_at: new Date().toISOString(),
          },
          error: null,
        };
      },
    },
    table: ({ tableName, op, payload }) => {
      if (op === "insert") {
        state.inserts.push({ table: tableName, payload });
        if (tableName === "message_jobs") {
          return { data: { id: "job-1" }, error: null };
        }
        return { data: { id: "new-row" }, error: null };
      }
      if (op === "select" && tableName === "message_jobs") {
        // 신규 idempotency 흐름: 기존 job 없음
        return { data: null, error: null };
      }
      return { data: null, error: null };
    },
  });
}

describe("sendMessage", () => {
  beforeEach(() => setupTestEnv());
  afterEach(() => clearSupabase());

  it("success — Aligo OK → wallet debited once, no refund, job status updated to sent", async () => {
    const state: State = { walletBalance: 1000, debitCalls: 0, refundCalls: 0, inserts: [] };
    injectSupabase(makeStatefulSupabase(state));
    const aligo = new MockAligoProvider();
    const result = await sendMessage(baseInput(), "user-1", { aligo });
    expect(result.ok).toBe(true);
    expect(result.status).toBe("sent");
    expect(result.chargedKrw).toBe(12);
    expect(result.balanceAfterKrw).toBe(988);
    expect(state.debitCalls).toBe(1);
    expect(state.refundCalls).toBe(0);
    // message_logs insert with status=sent
    expect(state.inserts.find((i) => i.table === "message_logs")).toBeDefined();
  });

  it("failure — Aligo returns error → wallet refunded, ProviderError thrown", async () => {
    const state: State = { walletBalance: 1000, debitCalls: 0, refundCalls: 0, inserts: [] };
    injectSupabase(makeStatefulSupabase(state));

    // 강제 실패 mock — receiver 가 999... 로 시작하면 MockAligoProvider 가 실패 반환
    const failingAligo: AligoProvider = {
      async sendMessage(_input: AligoSendInput): Promise<AligoSendResult> {
        return {
          ok: false,
          resultCode: "-99",
          resultMessage: "forced failure for test",
          raw: { test: true },
        };
      },
    };

    const input = { ...baseInput(), idempotency_key: "idem-fail-1234" };
    await expect(sendMessage(input, "user-1", { aligo: failingAligo })).rejects.toBeInstanceOf(ProviderError);

    expect(state.debitCalls).toBe(1);
    expect(state.refundCalls).toBe(1);
    expect(state.walletBalance).toBe(1000); // 차감 → 환불 = 원복
    // message_logs failed + message_jobs status=refunded
    const logs = state.inserts.filter((i) => i.table === "message_logs");
    expect(logs.length).toBeGreaterThan(0);
  });

  it("insufficient balance — debit raises, no Aligo call, no refund", async () => {
    const state: State = { walletBalance: 5, debitCalls: 0, refundCalls: 0, inserts: [] };
    injectSupabase(makeStatefulSupabase(state));
    const aligoSpy = { sendMessage: vi.fn() };
    await expect(
      sendMessage(baseInput(), "user-1", { aligo: aligoSpy as unknown as AligoProvider })
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect(aligoSpy.sendMessage).not.toHaveBeenCalled();
    expect(state.refundCalls).toBe(0);
  });
});

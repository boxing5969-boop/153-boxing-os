import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSupabase, injectSupabase, makeMockSupabase, setupTestEnv } from "./_mocks";
import { sendBulkMessages } from "../src/messages/sendBulkMessages";
import { processMessageJob } from "../src/messages/processMessageJob";
import type { AligoProvider, AligoSendResult } from "../src/providers/types";
import type { JobQueue, EnqueueResult, EnqueueOptions } from "../src/queue/types";
import type { SendBulkMessagesInput } from "../src/validation/schemas";

const TENANT = "11111111-1111-1111-1111-111111111111";
const SENDER = "22222222-2222-2222-2222-222222222222";

interface State {
  walletBalance: number;
  debitCalls: number;
  refundCalls: Array<{ amount: number; idemKey: string }>;
  inserts: Array<{ table: string; payload: unknown }>;
  enqueueCalls: number;
  failingJobIds: Set<string>;
}

function makeQueue(state: State, failingJobIds: Set<string> = new Set()): JobQueue {
  return {
    async enqueueMessageProcess(jobId: string, _opts?: EnqueueOptions): Promise<EnqueueResult> {
      state.enqueueCalls++;
      if (failingJobIds.has(jobId)) throw new Error(`enqueue refused for ${jobId}`);
      return { taskName: `task-${jobId}`, provider: "mock" };
    },
    async enqueueInvoiceProcess(jobId: string): Promise<EnqueueResult> {
      state.enqueueCalls++;
      return { taskName: `task-inv-${jobId}`, provider: "mock" };
    },
  };
}

function makeStatefulSupabase(state: State, ctx: { senderApproved?: boolean; jobIds?: string[] } = {}) {
  const senderApproved = ctx.senderApproved ?? true;
  return makeMockSupabase({
    rpc: {
      get_active_usage_price: (args) => {
        if (args.p_usage_type === "sms") return { data: [{ usage_type: "sms", cost_krw: 9, charge_krw: 12 }], error: null };
        if (args.p_usage_type === "lms") return { data: [{ usage_type: "lms", cost_krw: 26, charge_krw: 39 }], error: null };
        return { data: null, error: null };
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
        const amt = Number(args.p_amount_krw);
        state.refundCalls.push({ amount: amt, idemKey: String(args.p_idempotency_key) });
        state.walletBalance += amt;
        return {
          data: {
            id: `tx-refund-${state.refundCalls.length}`,
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
      if (tableName === "message_senders" && op === "select") {
        return senderApproved
          ? { data: { id: SENDER, sender_number: "0212345678", status: "approved", tenant_id: TENANT }, error: null }
          : { data: null, error: null };
      }
      if (tableName === "message_opt_outs" && op === "select") return { data: [], error: null };
      if (tableName === "message_consents" && op === "select") return { data: [], error: null };
      if (tableName === "message_jobs" && op === "insert") {
        state.inserts.push({ table: tableName, payload });
        const ids = ctx.jobIds ?? (Array.isArray(payload) ? payload.map((_, i) => `job-${i + 1}`) : ["job-1"]);
        return { data: ids.map((id) => ({ id })), error: null };
      }
      if (tableName === "service_wallets" && op === "select") {
        return { data: { balance_krw: state.walletBalance }, error: null };
      }
      return { data: null, error: null };
    },
  });
}

// (Reserved for future tests — currently unused; bulk only exercises enqueue path, not real send)
// const SuccessAligo: AligoProvider = { ... };

describe("sendBulkMessages", () => {
  beforeEach(() => setupTestEnv());
  afterEach(() => clearSupabase());

  it("10건 발송, 2건 enqueue 실패 → 정확히 2건 환불", async () => {
    const jobIds = Array.from({ length: 10 }, (_, i) => `job-${i + 1}`);
    const state: State = {
      walletBalance: 1000,
      debitCalls: 0,
      refundCalls: [],
      inserts: [],
      enqueueCalls: 0,
      failingJobIds: new Set(["job-3", "job-7"]),
    };
    injectSupabase(makeStatefulSupabase(state, { jobIds }));
    const queue = makeQueue(state, state.failingJobIds);

    const input: SendBulkMessagesInput = {
      tenant_id: TENANT,
      sender_id: SENDER,
      recipients: Array.from({ length: 10 }, (_, i) => `010-1234-56${String(i).padStart(2, "0")}`),
      message_type: "sms",
      category: "informational",
      content: "hello",
      idempotency_key: "bulk-test-1",
    };
    const r = await sendBulkMessages(input, "user-1", { queue });

    expect(r.total).toBe(10);
    expect(r.eligible).toBe(10);
    expect(r.enqueued).toBe(8);
    expect(r.failed_to_enqueue).toBe(2);
    expect(r.total_charged_krw).toBe(120);  // 10 * 12
    expect(r.total_refunded_krw).toBe(24);   // 2 * 12
    expect(state.debitCalls).toBe(1);
    expect(state.refundCalls.length).toBe(2);
    expect(state.refundCalls.every((c) => c.amount === 12)).toBe(true);
  });

  it("잔액 부족 → debit 실패, job 생성 안 됨, 환불 0", async () => {
    const state: State = { walletBalance: 50, debitCalls: 0, refundCalls: [], inserts: [], enqueueCalls: 0, failingJobIds: new Set() };
    injectSupabase(makeStatefulSupabase(state));
    const queue = makeQueue(state);

    const input: SendBulkMessagesInput = {
      tenant_id: TENANT,
      sender_id: SENDER,
      recipients: ["010-1234-5678", "010-1234-5679", "010-1234-5680", "010-1234-5681", "010-1234-5682"],
      message_type: "sms",
      category: "informational",
      content: "hi",
      idempotency_key: "bulk-low-bal",
    };
    await expect(sendBulkMessages(input, "user-1", { queue })).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect(state.refundCalls.length).toBe(0);
    expect(state.enqueueCalls).toBe(0);
  });

  it("marketing — opt-out 1건 + no consent 1건 → blocked, charge 만 eligible 만큼", async () => {
    const state: State = { walletBalance: 1000, debitCalls: 0, refundCalls: [], inserts: [], enqueueCalls: 0, failingJobIds: new Set() };
    injectSupabase(
      makeMockSupabase({
        rpc: {
          get_active_usage_price: () => ({ data: [{ usage_type: "lms", cost_krw: 26, charge_krw: 39 }], error: null }),
          debit_service_wallet: (args) => {
            state.debitCalls++;
            const amt = Number(args.p_amount_krw);
            state.walletBalance -= amt;
            return { data: { id: "tx", wallet_id: "w", amount_krw: -amt, balance_after_krw: state.walletBalance, created_at: new Date().toISOString() }, error: null };
          },
          refund_service_wallet: () => ({ data: { id: "rf", wallet_id: "w", amount_krw: 0, balance_after_krw: state.walletBalance, created_at: new Date().toISOString() }, error: null }),
        },
        table: ({ tableName, op, filters }) => {
          if (tableName === "message_senders") return { data: { id: SENDER, sender_number: "0212345678", status: "approved", tenant_id: TENANT }, error: null };
          if (tableName === "message_opt_outs" && op === "select") {
            return { data: [{ phone: "01011110001" }], error: null };
          }
          if (tableName === "message_consents" && op === "select") {
            return { data: [{ phone: "01022220001", marketing_allowed: true }, { phone: "01033330001", marketing_allowed: false }], error: null };
          }
          if (tableName === "message_jobs" && op === "insert") {
            state.inserts.push({ table: tableName, payload: filters });
            return { data: [{ id: "job-1" }], error: null };
          }
          if (tableName === "service_wallets") return { data: { balance_krw: state.walletBalance }, error: null };
          return { data: null, error: null };
        },
      })
    );
    const queue = makeQueue(state);
    const input: SendBulkMessagesInput = {
      tenant_id: TENANT,
      sender_id: SENDER,
      recipients: ["010-1111-0001", "010-2222-0001", "010-3333-0001"], // opt-out, consent, no-consent
      message_type: "lms",
      category: "marketing",
      content: "광고입니다. " + "x".repeat(100),  // ensure LMS
      idempotency_key: "bulk-mktg-1",
    };
    const r = await sendBulkMessages(input, "user-1", { queue });
    expect(r.total).toBe(3);
    expect(r.eligible).toBe(1);
    expect(r.blocked.length).toBe(2);
    expect(r.total_charged_krw).toBe(39);
  });

  it("eligible 0건 → debit 안함, summary 정상", async () => {
    const state: State = { walletBalance: 1000, debitCalls: 0, refundCalls: [], inserts: [], enqueueCalls: 0, failingJobIds: new Set() };
    injectSupabase(
      makeMockSupabase({
        rpc: {
          get_active_usage_price: () => ({ data: [{ usage_type: "sms", cost_krw: 9, charge_krw: 12 }], error: null }),
        },
        table: ({ tableName }) => {
          if (tableName === "message_senders") return { data: { id: SENDER, sender_number: "0212345678", status: "approved", tenant_id: TENANT }, error: null };
          if (tableName === "message_opt_outs") return { data: [{ phone: "01099990001" }], error: null };
          if (tableName === "message_consents") return { data: [], error: null };
          return { data: null, error: null };
        },
      })
    );
    const queue = makeQueue(state);
    const input: SendBulkMessagesInput = {
      tenant_id: TENANT, sender_id: SENDER, recipients: ["010-9999-0001"],
      message_type: "sms", category: "marketing", content: "광고",
      idempotency_key: "bulk-none",
    };
    const r = await sendBulkMessages(input, "user-1", { queue });
    expect(r.eligible).toBe(0);
    expect(r.total_charged_krw).toBe(0);
    expect(state.debitCalls).toBe(0);
  });
});

describe("processMessageJob — duplicate task delivery", () => {
  beforeEach(() => setupTestEnv());
  afterEach(() => clearSupabase());

  it("이미 sent 인 job 재호출 → skip (no double send)", async () => {
    const aligoSpy = { sendMessage: vi.fn() };
    injectSupabase(
      makeMockSupabase({
        table: ({ tableName, op }) => {
          if (tableName === "message_jobs" && op === "select") {
            return {
              data: {
                id: "job-already-sent",
                company_id: TENANT,
                status: "sent",
                recipient_phone: "01012345678",
                content: "hi",
                message_type: "sms",
                payload: { sender: "0212345678" },
                wallet_charge_krw: 12,
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
      })
    );
    const r = await processMessageJob("job-already-sent", { aligo: aligoSpy as unknown as AligoProvider });
    expect(r.status).toBe("skipped");
    expect(aligoSpy.sendMessage).not.toHaveBeenCalled();
  });

  it("transient provider 실패 → retryable=true, 환불 안함", async () => {
    const state: State = { walletBalance: 1000, debitCalls: 0, refundCalls: [], inserts: [], enqueueCalls: 0, failingJobIds: new Set() };
    injectSupabase(
      makeMockSupabase({
        rpc: {
          refund_service_wallet: () => { throw new Error("refund should not be called for transient"); },
        },
        table: ({ tableName, op }) => {
          if (tableName === "message_jobs" && op === "select") {
            return {
              data: {
                id: "job-1",
                company_id: TENANT,
                status: "queued",
                recipient_phone: "01012345678",
                content: "hi",
                message_type: "sms",
                payload: { sender: "0212345678" },
                wallet_charge_krw: 12,
                retry_count: 0,
              },
              error: null,
            };
          }
          if (tableName === "message_jobs" && op === "update") {
            return { data: { id: "job-1" }, error: null };
          }
          return { data: null, error: null };
        },
      })
    );
    const transientAligo: AligoProvider = {
      async sendMessage(): Promise<AligoSendResult> {
        return { ok: false, resultCode: "-99", resultMessage: "server error", raw: {} };
      },
    };
    const r = await processMessageJob("job-1", { aligo: transientAligo });
    expect(r.ok).toBe(false);
    expect(r.retryable).toBe(true);
    expect(r.status).toBe("failed");
    expect(state.refundCalls.length).toBe(0);
  });

  it("permanent 실패 → retryable=false, 환불 처리", async () => {
    const state: State = { walletBalance: 1000, debitCalls: 0, refundCalls: [], inserts: [], enqueueCalls: 0, failingJobIds: new Set() };
    injectSupabase(
      makeMockSupabase({
        rpc: {
          refund_service_wallet: (args) => {
            state.refundCalls.push({ amount: Number(args.p_amount_krw), idemKey: String(args.p_idempotency_key) });
            return { data: { id: "rf", wallet_id: "w", amount_krw: Number(args.p_amount_krw), balance_after_krw: 1012, created_at: new Date().toISOString() }, error: null };
          },
        },
        table: ({ tableName, op }) => {
          if (tableName === "message_jobs" && op === "select") {
            return {
              data: {
                id: "job-p",
                company_id: TENANT,
                status: "queued",
                recipient_phone: "01012345678",
                content: "hi",
                message_type: "sms",
                payload: { sender: "0212345678" },
                wallet_charge_krw: 12,
                retry_count: 0,
              },
              error: null,
            };
          }
          if (tableName === "message_jobs" && op === "update") {
            return { data: { id: "job-p" }, error: null };
          }
          return { data: null, error: null };
        },
      })
    );
    const permAligo: AligoProvider = {
      async sendMessage(): Promise<AligoSendResult> {
        return { ok: false, resultCode: "-101", resultMessage: "invalid phone", raw: {} };
      },
    };
    const r = await processMessageJob("job-p", { aligo: permAligo });
    expect(r.ok).toBe(false);
    expect(r.retryable).toBe(false);
    expect(r.status).toBe("refunded");
    expect(state.refundCalls.length).toBe(1);
    expect(state.refundCalls[0]?.amount).toBe(12);
  });
});

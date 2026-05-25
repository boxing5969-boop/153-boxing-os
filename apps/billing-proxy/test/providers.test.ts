import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { setupTestEnv } from "./_mocks";
import { resetConfigCache } from "../src/config";
import {
  MockAligoProvider,
  RealAligoProvider,
  buildAligoProvider,
  redactAligoRequest,
} from "../src/providers/aligo";
import {
  MockPayssamProvider,
  RealPayssamProvider,
  buildPayssamProvider,
} from "../src/providers/payssam";

describe("MockAligoProvider", () => {
  it("sendSms — 예측 가능한 provider_message_id 시퀀스", async () => {
    const p = new MockAligoProvider();
    const r1 = await p.sendSms({ sender: "0212345678", receiver: "01012345678", msg: "hello" });
    const r2 = await p.sendSms({ sender: "0212345678", receiver: "01012345679", msg: "world" });
    expect(r1.success).toBe(true);
    expect(r1.status).toBe("sent");
    expect(r1.providerMessageId).toBe("mock-sms-1");
    expect(r2.providerMessageId).toBe("mock-sms-2");
  });

  it("999 로 시작하는 수신번호 → 강제 실패 (-99)", async () => {
    const p = new MockAligoProvider();
    const r = await p.sendSms({ sender: "0212345678", receiver: "99912345678", msg: "x" });
    expect(r.success).toBe(false);
    expect(r.status).toBe("failed");
    expect(r.resultCode).toBe("-99");
  });

  it("sendLms — title 받아도 성공", async () => {
    const r = await new MockAligoProvider().sendLms({ sender: "0212345678", receiver: "01012345678", msg: "long...", title: "공지" });
    expect(r.success).toBe(true);
    expect(r.providerMessageId).toMatch(/^mock-lms-/);
  });

  it("sendMms — mock 모드는 성공", async () => {
    const r = await new MockAligoProvider().sendMms({ sender: "0212345678", receiver: "01012345678", msg: "mms", imageUrl: "https://x.example/y.png" });
    expect(r.success).toBe(true);
    expect(r.providerMessageId).toMatch(/^mock-mms-/);
  });
});

describe("RealAligoProvider", () => {
  it("sendMms → NOT_IMPLEMENTED (placeholder)", async () => {
    const p = new RealAligoProvider("dummy-key", "dummy-uid");
    const r = await p.sendMms({ sender: "0212345678", receiver: "01012345678", msg: "x" });
    expect(r.success).toBe(false);
    expect(r.resultCode).toBe("NOT_IMPLEMENTED");
  });

  it("apiKey/userId 누락 시 생성 실패", () => {
    expect(() => new RealAligoProvider("", "uid")).toThrow();
    expect(() => new RealAligoProvider("key", "")).toThrow();
  });
});

describe("redactAligoRequest", () => {
  it("수신번호 마스킹 + API key 미포함", () => {
    const out = redactAligoRequest({
      sender: "0212345678",
      receiver: "01012345678",
      msg: "안녕하세요 이것은 긴 본문",
      msgType: "LMS",
      title: "공지",
    });
    expect(out.receiver).toBe("010****5678");
    expect(JSON.stringify(out)).not.toContain("01012345678");
    // API key 필드 없음
    expect(Object.keys(out)).not.toContain("key");
    expect(Object.keys(out)).not.toContain("apiKey");
  });
});

describe("MockPayssamProvider", () => {
  it("createInvoice → 예측 가능한 ID + paymentUrl", async () => {
    const p = new MockPayssamProvider();
    const r = await p.createInvoice({
      amountKrw: 50_000,
      customerPhone: "01012345678",
      itemName: "1개월",
      idempotencyKey: "test-1",
    });
    expect(r.success).toBe(true);
    expect(r.status).toBe("created");
    expect(r.providerInvoiceId).toBe("mock-inv-1");
    expect(r.paymentUrl).toContain("test-1");
  });

  it("amount=0 → 강제 실패", async () => {
    const r = await new MockPayssamProvider().createInvoice({
      amountKrw: 0,
      customerPhone: "01012345678",
      itemName: "x",
      idempotencyKey: "test-fail-1",
    });
    expect(r.success).toBe(false);
    expect(r.resultCode).toBe("BAD_REQUEST");
  });

  it("parsePaymentWebhook — paid/success/completed 정규화", () => {
    const p = new MockPayssamProvider();
    for (const s of ["paid", "PAID", "success", "completed", "approved"]) {
      const out = p.parsePaymentWebhook({
        rawBody: "{}",
        headers: {},
        payload: { status: s, invoice_id: "INV-1", payment_id: "P-1", amount: 50000, paid_at: "2026-01-01T00:00:00Z" },
      });
      expect(out.valid).toBe(true);
      expect(out.status).toBe("paid");
      expect(out.providerInvoiceId).toBe("INV-1");
      expect(out.providerPaymentId).toBe("P-1");
      expect(out.amountKrw).toBe(50000);
    }
  });

  it("parsePaymentWebhook — 알 수 없는 status → 'unknown'", () => {
    const out = new MockPayssamProvider().parsePaymentWebhook({
      rawBody: "{}",
      headers: {},
      payload: { status: "weird_state", invoice_id: "INV-1" },
    });
    expect(out.status).toBe("unknown");
  });

  it("parsePaymentWebhook — 비-object payload → invalid", () => {
    const out = new MockPayssamProvider().parsePaymentWebhook({ rawBody: "", headers: {}, payload: "string" });
    expect(out.valid).toBe(false);
  });
});

describe("RealPayssamProvider — webhook signature", () => {
  const SECRET = "test-webhook-secret-123";

  it("올바른 HMAC-SHA256 서명 → valid=true", () => {
    const p = new RealPayssamProvider("key", "https://x.example", SECRET);
    const body = JSON.stringify({ status: "paid", invoice_id: "INV-OK", payment_id: "P-OK" });
    const sig = crypto.createHmac("sha256", SECRET).update(body).digest("hex");
    const out = p.parsePaymentWebhook({
      rawBody: body,
      headers: { "x-payssam-signature": sig },
      payload: JSON.parse(body),
    });
    expect(out.valid).toBe(true);
    expect(out.status).toBe("paid");
  });

  it("잘못된 서명 → valid=false", () => {
    const p = new RealPayssamProvider("key", "https://x.example", SECRET);
    const body = JSON.stringify({ status: "paid" });
    const out = p.parsePaymentWebhook({
      rawBody: body,
      headers: { "x-payssam-signature": "bogus" },
      payload: JSON.parse(body),
    });
    expect(out.valid).toBe(false);
    expect(out.errorMessage).toMatch(/signature/);
  });

  it("서명 헤더 누락 → valid=false", () => {
    const p = new RealPayssamProvider("key", "https://x.example", SECRET);
    const out = p.parsePaymentWebhook({ rawBody: "{}", headers: {}, payload: {} });
    expect(out.valid).toBe(false);
    expect(out.errorMessage).toMatch(/missing.*Signature/);
  });

  it("webhookSecret 미설정 → 서명 검증 skip + 정규화만", () => {
    const p = new RealPayssamProvider("key", "https://x.example", undefined);
    const out = p.parsePaymentWebhook({
      rawBody: "{}",
      headers: {},
      payload: { status: "paid", invoice_id: "INV-NO-SIG" },
    });
    expect(out.valid).toBe(true);
    expect(out.providerInvoiceId).toBe("INV-NO-SIG");
  });
});

describe("Factory — PROVIDER_MODE=live 시 env 누락 → throw", () => {
  beforeEach(() => {
    // 새 NODE_ENV=production + PROVIDER_MODE=live 시뮬레이션 — config 캐시 무효화
    resetConfigCache();
  });

  it("Aligo: live 모드 + API key 누락 → throw", () => {
    setupTestEnv({ PROVIDER_MODE: "live", ALIGO_API_KEY: "", ALIGO_USER_ID: "" });
    expect(() => buildAligoProvider()).toThrow(/PROVIDER_MODE=live.*ALIGO/i);
  });

  it("Payssam: live 모드 + API key 누락 → throw", () => {
    setupTestEnv({ PROVIDER_MODE: "live", PAYSSAM_API_KEY: "", PAYSSAM_API_BASE_URL: "https://x.example" });
    expect(() => buildPayssamProvider()).toThrow(/PROVIDER_MODE=live.*PAYSSAM/i);
  });

  it("Aligo: live 모드 + env 완비 → RealAligoProvider 생성", () => {
    setupTestEnv({ PROVIDER_MODE: "live", ALIGO_API_KEY: "real-key", ALIGO_USER_ID: "real-uid" });
    const p = buildAligoProvider();
    expect(p).toBeInstanceOf(RealAligoProvider);
  });

  it("mock 모드 (default test) → MockAligoProvider", () => {
    setupTestEnv();  // NODE_ENV=test → mock
    const p = buildAligoProvider();
    expect(p).toBeInstanceOf(MockAligoProvider);
  });
});

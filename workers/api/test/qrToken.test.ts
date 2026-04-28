import { describe, it, expect, vi, afterEach } from "vitest";
import { generateQrToken, verifyQrToken } from "../src/services/qrToken";

const SECRET = "test-secret-32-bytes-min-padding-x";

describe("qrToken", () => {
  afterEach(() => vi.useRealTimers());

  it("generate + verify roundtrip", async () => {
    const { token, expires_at, nonce } = await generateQrToken(SECRET, "m1", "b1");
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));

    const result = await verifyQrToken(SECRET, token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.member_id).toBe("m1");
      expect(result.payload.branch_id).toBe("b1");
      expect(result.payload.nonce).toBe(nonce);
      expect(result.payload.expires_at).toBe(expires_at);
    }
  });

  it("rejects expired token (past 60s)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { token } = await generateQrToken(SECRET, "m1", "b1");

    vi.setSystemTime(new Date("2026-01-01T00:01:01Z")); // +61s
    const result = await verifyQrToken(SECRET, token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("qr_expired");
  });

  it("accepts token at edge (just under 60s)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { token } = await generateQrToken(SECRET, "m1", "b1");

    vi.setSystemTime(new Date("2026-01-01T00:00:59Z")); // +59s
    const result = await verifyQrToken(SECRET, token);
    expect(result.ok).toBe(true);
  });

  it("rejects malformed token", async () => {
    const result = await verifyQrToken(SECRET, "not-a-real-token");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("qr_malformed");
  });

  it("rejects token with wrong signing secret", async () => {
    const { token } = await generateQrToken(SECRET, "m1", "b1");
    const result = await verifyQrToken("different-secret", token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("qr_invalid_signature");
  });

  it("rejects token with tampered payload", async () => {
    const { token } = await generateQrToken(SECRET, "m1", "b1");
    // base64url decode → tamper member_id → re-encode (signature stays same)
    const padded = token.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const json = JSON.parse(decoded);
    json.payload.member_id = "evil-member";
    const tamperedJson = JSON.stringify(json);
    const tamperedToken = btoa(tamperedJson)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const result = await verifyQrToken(SECRET, tamperedToken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("qr_invalid_signature");
  });

  it("each generation has a unique nonce", async () => {
    const a = await generateQrToken(SECRET, "m1", "b1");
    const b = await generateQrToken(SECRET, "m1", "b1");
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.token).not.toBe(b.token);
  });
});

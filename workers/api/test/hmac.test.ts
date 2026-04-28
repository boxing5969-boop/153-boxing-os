import { describe, it, expect } from "vitest";
import { hmacSign, hmacVerify, sha256Hex } from "../src/lib/hmac";

describe("hmac", () => {
  it("sign + verify roundtrip", async () => {
    const sig = await hmacSign("secret", "payload");
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(await hmacVerify("secret", "payload", sig)).toBe(true);
  });

  it("verify rejects mismatched signature", async () => {
    const sig = await hmacSign("secret", "payload");
    expect(await hmacVerify("secret", "payload-tampered", sig)).toBe(false);
  });

  it("verify rejects wrong secret", async () => {
    const sig = await hmacSign("secret-a", "payload");
    expect(await hmacVerify("secret-b", "payload", sig)).toBe(false);
  });

  it("verify rejects malformed hex", async () => {
    expect(await hmacVerify("secret", "payload", "not-hex!!")).toBe(false);
    expect(await hmacVerify("secret", "payload", "")).toBe(false);
    expect(await hmacVerify("secret", "payload", "abc")).toBe(false); // odd length
  });

  it("sha256Hex deterministic + 64 char hex", async () => {
    const a = await sha256Hex("hello");
    const b = await sha256Hex("hello");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sha256Hex empty string matches well-known value", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });
});

import { describe, it, expect } from "vitest";
import {
  decryptDeviceKey,
  encryptDeviceKey,
  fingerprintKey,
  generateRandomKey,
} from "../src/lib/keyEncryption";

const MASTER = "super-secret-master-key-for-tests-32+";

describe("keyEncryption", () => {
  it("encrypt + decrypt roundtrip", async () => {
    const plain = "device-api-key-12345";
    const enc = await encryptDeviceKey(MASTER, plain);
    expect(enc).toMatch(/^[A-Za-z0-9+/=]+$/);
    const out = await decryptDeviceKey(MASTER, enc);
    expect(out).toBe(plain);
  });

  it("decrypt rejects wrong master secret", async () => {
    const enc = await encryptDeviceKey(MASTER, "secret");
    await expect(decryptDeviceKey("different-master-key", enc)).rejects.toThrow();
  });

  it("encrypt produces unique ciphertext for same input (random IV)", async () => {
    const a = await encryptDeviceKey(MASTER, "same-plaintext");
    const b = await encryptDeviceKey(MASTER, "same-plaintext");
    expect(a).not.toBe(b);
    // 둘 다 복호화는 동일 평문 반환
    expect(await decryptDeviceKey(MASTER, a)).toBe("same-plaintext");
    expect(await decryptDeviceKey(MASTER, b)).toBe("same-plaintext");
  });

  it("decrypt rejects truncated ciphertext", async () => {
    await expect(decryptDeviceKey(MASTER, "abc")).rejects.toThrow();
  });

  it("decrypt rejects tampered ciphertext (AES-GCM 인증 실패)", async () => {
    const enc = await encryptDeviceKey(MASTER, "plain");
    const tampered = enc.slice(0, -2) + "AA";
    await expect(decryptDeviceKey(MASTER, tampered)).rejects.toThrow();
  });

  it("fingerprintKey shows last 4 only", () => {
    expect(fingerprintKey("longSecret1234")).toBe("…1234");
    expect(fingerprintKey("ab")).toBe("—");
  });

  it("generateRandomKey produces base64url length proportional to byteLength", () => {
    const a = generateRandomKey(32);
    const b = generateRandomKey(32);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });
});

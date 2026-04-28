/**
 * AES-GCM 기반 device api_key 암호화/복호화.
 * 마스터 시크릿(DEVICE_KMS_KEY) → SHA-256 → 32-byte AES key 유도.
 * 암호문 형식: base64(iv(12) || ciphertext+tag).
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

async function deriveAesKey(masterSecret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(masterSecret));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptDeviceKey(
  masterSecret: string,
  plaintext: string
): Promise<string> {
  const key = await deriveAesKey(masterSecret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext)
  );
  const combined = new Uint8Array(iv.length + cipher.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(cipher), iv.length);
  return bytesToBase64(combined);
}

export async function decryptDeviceKey(
  masterSecret: string,
  ciphertextB64: string
): Promise<string> {
  const key = await deriveAesKey(masterSecret);
  const combined = base64ToBytes(ciphertextB64);
  if (combined.length < 13) {
    throw new Error("ciphertext too short");
  }
  const iv = combined.slice(0, 12);
  const cipher = combined.slice(12);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    cipher
  );
  return dec.decode(plain);
}

export function fingerprintKey(plaintext: string): string {
  if (plaintext.length <= 4) return "—";
  return `…${plaintext.slice(-4)}`;
}

export function generateRandomKey(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesToBase64(bytes: Uint8Array): string {
  let str = "";
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i] as number);
  }
  return btoa(str);
}

function base64ToBytes(s: string): Uint8Array {
  // base64 또는 base64url 둘 다 허용
  const std = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = std + "=".repeat((4 - (std.length % 4)) % 4);
  const str = atob(padded);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

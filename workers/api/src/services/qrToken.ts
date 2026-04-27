import { hmacSign } from "../lib/hmac";

export interface QrTokenPayload {
  member_id: string;
  branch_id: string;
  nonce: string;
  expires_at: number; // unix seconds
}

interface SignedQrToken {
  payload: QrTokenPayload;
  signature: string;
}

const TTL_SECONDS = 60;

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function base64urlEncode(json: string): string {
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(s: string): string {
  const pad = (4 - (s.length % 4)) % 4;
  const padded = (s + "=".repeat(pad)).replace(/-/g, "+").replace(/_/g, "/");
  return atob(padded);
}

function payloadToData(p: QrTokenPayload): string {
  return `${p.member_id}|${p.branch_id}|${p.nonce}|${p.expires_at}`;
}

export async function generateQrToken(
  secret: string,
  member_id: string,
  branch_id: string
): Promise<{ token: string; expires_at: number; nonce: string }> {
  const nonce = randomNonce();
  const expires_at = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const payload: QrTokenPayload = { member_id, branch_id, nonce, expires_at };
  const signature = await hmacSign(secret, payloadToData(payload));
  const signed: SignedQrToken = { payload, signature };
  const token = base64urlEncode(JSON.stringify(signed));
  return { token, expires_at, nonce };
}

export type VerifyResult =
  | { ok: true; payload: QrTokenPayload }
  | { ok: false; reason: "qr_invalid_signature" | "qr_expired" | "qr_malformed" };

export async function verifyQrToken(secret: string, token: string): Promise<VerifyResult> {
  let signed: SignedQrToken;
  try {
    const parsed = JSON.parse(base64urlDecode(token)) as Partial<SignedQrToken>;
    if (!parsed.payload || !parsed.signature) {
      return { ok: false, reason: "qr_malformed" };
    }
    signed = parsed as SignedQrToken;
  } catch {
    return { ok: false, reason: "qr_malformed" };
  }

  const expected = await hmacSign(secret, payloadToData(signed.payload));
  if (expected !== signed.signature) {
    return { ok: false, reason: "qr_invalid_signature" };
  }

  if (Math.floor(Date.now() / 1000) >= signed.payload.expires_at) {
    return { ok: false, reason: "qr_expired" };
  }

  return { ok: true, payload: signed.payload };
}

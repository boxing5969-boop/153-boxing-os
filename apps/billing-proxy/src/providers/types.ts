/**
 * Provider 인터페이스 — Real / Mock 둘 다 같은 시그니처.
 * 테스트에서 mock 으로 주입 가능.
 */

// ---------------- Aligo (SMS/LMS/MMS) ----------------
export interface AligoSendInput {
  sender: string;        // 발신번호 (digits)
  receiver: string;      // 수신번호 (digits)
  msg: string;
  msgType: "SMS" | "LMS" | "MMS";
  title?: string;        // LMS/MMS title
}

export interface AligoSendResult {
  ok: boolean;
  providerMessageId?: string;
  resultCode: string;
  resultMessage: string;
  raw: unknown;
}

export interface AligoProvider {
  sendMessage(input: AligoSendInput): Promise<AligoSendResult>;
}

// ---------------- Payssam (결제선생) ----------------
export interface PayssamCreateInvoiceInput {
  amountKrw: number;
  customerName?: string;
  customerPhone: string;
  itemName: string;
  memo?: string;
  idempotencyKey: string;
  callbackUrl?: string;
}

export interface PayssamCreateInvoiceResult {
  ok: boolean;
  providerInvoiceId?: string;
  paymentUrl?: string;
  resultCode: string;
  resultMessage: string;
  raw: unknown;
}

export interface PayssamProvider {
  createInvoice(input: PayssamCreateInvoiceInput): Promise<PayssamCreateInvoiceResult>;
}

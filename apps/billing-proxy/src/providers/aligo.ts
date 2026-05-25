/**
 * Aligo SMS/LMS/MMS Provider.
 *
 * 실 API: POST https://apis.aligo.in/send/
 *   form-urlencoded: key, user_id, sender, receiver, msg, msg_type, title?
 *   응답: { result_code: "1" = success, message, msg_id?, success_cnt?, error_cnt? }
 *
 * 정책 (B2B SaaS):
 *   - HQ 단일 계정 사용 (각 tenant 가 자체 API 키 보유하는 기존 모델과 분리)
 *   - 발신번호는 message_senders 테이블에서 선택 — 없으면 ALIGO_SENDER_DEFAULT
 */
import { loadConfig } from "../config";
import type { AligoProvider, AligoSendInput, AligoSendResult } from "./types";

export class RealAligoProvider implements AligoProvider {
  constructor(private readonly apiKey: string, private readonly userId: string) {}

  async sendMessage(input: AligoSendInput): Promise<AligoSendResult> {
    const params = new URLSearchParams({
      key: this.apiKey,
      user_id: this.userId,
      sender: input.sender,
      receiver: input.receiver,
      msg: input.msg,
      msg_type: input.msgType,
    });
    if (input.title) params.set("title", input.title);

    let res: Response;
    try {
      res = await fetch("https://apis.aligo.in/send/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
    } catch (err) {
      return {
        ok: false,
        resultCode: "NETWORK_ERROR",
        resultMessage: err instanceof Error ? err.message : "fetch failed",
        raw: { networkError: true },
      };
    }

    let json: { result_code?: string | number; message?: string; msg_id?: string | number } & Record<string, unknown>;
    try {
      json = (await res.json()) as typeof json;
    } catch {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        resultCode: String(res.status),
        resultMessage: text || "non-json response",
        raw: { status: res.status, text },
      };
    }

    const code = String(json.result_code ?? "");
    return {
      ok: code === "1",
      providerMessageId: json.msg_id != null ? String(json.msg_id) : undefined,
      resultCode: code || String(res.status),
      resultMessage: json.message ?? "",
      raw: json,
    };
  }
}

export class MockAligoProvider implements AligoProvider {
  async sendMessage(input: AligoSendInput): Promise<AligoSendResult> {
    // 999 로 시작하는 수신번호는 강제 실패 (테스트 용)
    if (input.receiver.startsWith("999")) {
      return {
        ok: false,
        resultCode: "-99",
        resultMessage: "mock forced failure",
        raw: { mock: true, input },
      };
    }
    return {
      ok: true,
      providerMessageId: `mock-${Date.now()}`,
      resultCode: "1",
      resultMessage: "mock success",
      raw: { mock: true, input },
    };
  }
}

/** 환경설정에 따라 Real 또는 Mock 반환. */
export function buildAligoProvider(): AligoProvider {
  const cfg = loadConfig();
  if (cfg.MOCK_PROVIDERS || cfg.NODE_ENV === "test") {
    return new MockAligoProvider();
  }
  if (!cfg.ALIGO_API_KEY || !cfg.ALIGO_USER_ID) {
    throw new Error("ALIGO_API_KEY and ALIGO_USER_ID required when MOCK_PROVIDERS=false");
  }
  return new RealAligoProvider(cfg.ALIGO_API_KEY, cfg.ALIGO_USER_ID);
}

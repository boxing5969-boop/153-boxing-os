/**
 * Aligo SMS/LMS/MMS Provider — Real + Mock.
 *
 * 실 API:
 *   POST https://apis.aligo.in/send/
 *   form-urlencoded: key, user_id, sender, receiver, msg, msg_type, title?
 *   응답: { result_code: "1"=ok, message, msg_id?, success_cnt?, error_cnt? }
 *
 * 보안 원칙:
 *   - API 호출은 Cloud Run 의 고정 outbound IP 에서 발생 (Aligo 콘솔에 IP 화이트리스트 등록 필수)
 *   - API key 는 로그·external_api_logs 에 절대 포함하지 않음 (redactRequest)
 *   - frontend 에서 직접 호출 금지 (이 모듈은 Cloud Run 서버 측에서만)
 *
 * MMS:
 *   실 Aligo MMS 는 multipart/form-data 로 이미지 첨부 필요. 현재는 placeholder —
 *   RealAligoProvider.sendMms 호출 시 명확한 에러 반환. MockAligoProvider 는 성공 흉내.
 */
import { loadConfig } from "../config";
import type { AligoLmsInput, AligoMmsInput, AligoProvider, AligoSendResult, AligoSmsInput } from "./types";

/** API key / user_id 를 제거한 redact 된 요청 메타 (external_api_logs 용) */
export function redactAligoRequest(req: {
  sender: string;
  receiver: string;
  msg: string;
  msgType: "SMS" | "LMS" | "MMS";
  title?: string;
}): Record<string, unknown> {
  return {
    msgType: req.msgType,
    sender: req.sender,
    receiver: maskPhone(req.receiver),
    contentLength: req.msg.length,
    contentPreview: req.msg.slice(0, 20),
    title: req.title,
  };
}

function maskPhone(phone: string): string {
  if (!phone || phone.length < 7) return "****";
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

const ALIGO_URL = "https://apis.aligo.in/send/";

interface AligoFormBase {
  sender: string;
  receiver: string;
  msg: string;
  msgType: "SMS" | "LMS" | "MMS";
  title?: string;
}

async function callAligo(
  apiKey: string,
  userId: string,
  req: AligoFormBase
): Promise<AligoSendResult> {
  const params = new URLSearchParams({
    key: apiKey,
    user_id: userId,
    sender: req.sender,
    receiver: req.receiver,
    msg: req.msg,
    msg_type: req.msgType,
  });
  if (req.title) params.set("title", req.title);

  let res: Response;
  try {
    res = await fetch(ALIGO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
  } catch (err) {
    return {
      success: false,
      status: "failed",
      resultCode: "NETWORK_ERROR",
      errorMessage: err instanceof Error ? err.message : "fetch failed",
      raw: { networkError: true },
    };
  }

  let json: { result_code?: string | number; message?: string; msg_id?: string | number } & Record<string, unknown>;
  try {
    json = (await res.json()) as typeof json;
  } catch {
    const text = await res.text().catch(() => "");
    return {
      success: false,
      status: "failed",
      resultCode: String(res.status),
      errorMessage: text || "non-json response",
      raw: { status: res.status, text },
    };
  }

  const code = String(json.result_code ?? "");
  const success = code === "1";
  return {
    success,
    status: success ? "sent" : "failed",
    providerMessageId: json.msg_id != null ? String(json.msg_id) : undefined,
    resultCode: code || String(res.status),
    errorMessage: success ? undefined : json.message ?? "unknown aligo error",
    raw: json,
  };
}

// ============================================================
// Real
// ============================================================
export class RealAligoProvider implements AligoProvider {
  constructor(private readonly apiKey: string, private readonly userId: string) {
    if (!apiKey || !userId) {
      throw new Error("RealAligoProvider requires apiKey and userId");
    }
  }

  sendSms(input: AligoSmsInput): Promise<AligoSendResult> {
    return callAligo(this.apiKey, this.userId, { ...input, msgType: "SMS" });
  }

  sendLms(input: AligoLmsInput): Promise<AligoSendResult> {
    return callAligo(this.apiKey, this.userId, { ...input, msgType: "LMS" });
  }

  async sendMms(_input: AligoMmsInput): Promise<AligoSendResult> {
    // TODO: Aligo MMS 는 multipart/form-data 로 이미지 (image1~image3) 첨부 필요.
    //       파일 핸들링 인프라 준비 후 구현.
    return {
      success: false,
      status: "failed",
      resultCode: "NOT_IMPLEMENTED",
      errorMessage: "MMS sending is not yet implemented in RealAligoProvider — file handling pending",
      raw: { todo: "implement Aligo MMS multipart upload" },
    };
  }
}

// ============================================================
// Mock — 운영 의존 없이 예측 가능한 응답
// ============================================================
export class MockAligoProvider implements AligoProvider {
  private seq = 0;
  private nextId(prefix: string): string {
    this.seq++;
    return `mock-${prefix}-${this.seq}`;
  }

  private failIfMagic(receiver: string, msgType: string): AligoSendResult | null {
    // 수신번호가 "999" 로 시작하면 강제 실패 (테스트용)
    if (receiver.startsWith("999")) {
      return {
        success: false,
        status: "failed",
        resultCode: "-99",
        errorMessage: "mock forced failure (receiver starts with 999)",
        raw: { mock: true, msgType },
      };
    }
    return null;
  }

  async sendSms(input: AligoSmsInput): Promise<AligoSendResult> {
    const failed = this.failIfMagic(input.receiver, "SMS");
    if (failed) return failed;
    return {
      success: true,
      status: "sent",
      providerMessageId: this.nextId("sms"),
      resultCode: "1",
      raw: { mock: true, msgType: "SMS", echo: input },
    };
  }

  async sendLms(input: AligoLmsInput): Promise<AligoSendResult> {
    const failed = this.failIfMagic(input.receiver, "LMS");
    if (failed) return failed;
    return {
      success: true,
      status: "sent",
      providerMessageId: this.nextId("lms"),
      resultCode: "1",
      raw: { mock: true, msgType: "LMS", echo: input },
    };
  }

  async sendMms(input: AligoMmsInput): Promise<AligoSendResult> {
    const failed = this.failIfMagic(input.receiver, "MMS");
    if (failed) return failed;
    return {
      success: true,
      status: "sent",
      providerMessageId: this.nextId("mms"),
      resultCode: "1",
      raw: { mock: true, msgType: "MMS", echo: { ...input, imageBuffer: input.imageBuffer ? "<bytes>" : undefined } },
    };
  }
}

// ============================================================
// Factory — PROVIDER_MODE 기반 자동 선택, live 모드에서 env 누락 시 명확한 에러
// ============================================================
export function buildAligoProvider(): AligoProvider {
  const cfg = loadConfig();
  const mode = resolveProviderMode(cfg);

  if (mode === "mock") {
    return new MockAligoProvider();
  }

  if (!cfg.ALIGO_API_KEY || !cfg.ALIGO_USER_ID) {
    throw new Error(
      "PROVIDER_MODE=live but ALIGO_API_KEY / ALIGO_USER_ID is missing — refuse to start to prevent silent failure"
    );
  }
  return new RealAligoProvider(cfg.ALIGO_API_KEY, cfg.ALIGO_USER_ID);
}

function resolveProviderMode(cfg: ReturnType<typeof loadConfig>): "mock" | "live" {
  // PROVIDER_MODE 가 명시되면 우선 — 그 다음 MOCK_PROVIDERS (backward compat), test/dev 는 기본 mock
  if (cfg.PROVIDER_MODE) return cfg.PROVIDER_MODE;
  if (cfg.MOCK_PROVIDERS) return "mock";
  if (cfg.NODE_ENV === "test" || cfg.NODE_ENV === "development") return "mock";
  return "live";
}

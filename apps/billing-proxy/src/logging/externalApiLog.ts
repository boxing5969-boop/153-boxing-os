/**
 * external_api_logs 적재 헬퍼.
 * 실패해도 throw 하지 않음 — best-effort. 로그만 남기고 호출 흐름 진행.
 */
import { getSupabase } from "../lib/supabase";
import { logger } from "../lib/logger";

export interface ExternalApiLogInput {
  tenantId?: string | null;
  provider: string;             // 'aligo', 'payssam', 'kt_call_assistant'
  endpoint: string;
  requestId?: string;
  status: "success" | "error" | "skipped" | "mock_success" | "mock_error" | string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  errorMessage?: string;
}

export async function logExternalApiCall(input: ExternalApiLogInput): Promise<void> {
  try {
    const supa = getSupabase();
    const { error } = await supa.from("external_api_logs").insert({
      tenant_id: input.tenantId ?? null,
      provider: input.provider,
      endpoint: input.endpoint,
      request_id: input.requestId ?? null,
      status: input.status,
      request_payload: input.requestPayload ?? null,
      response_payload: input.responsePayload ?? null,
      error_message: input.errorMessage ?? null,
    });
    if (error) {
      logger.warn({ provider: input.provider, err: error.message }, "external_api_logs insert failed");
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "logExternalApiCall threw");
  }
}

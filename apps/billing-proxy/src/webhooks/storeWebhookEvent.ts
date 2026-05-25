/**
 * webhook_events 멱등 INSERT.
 * 같은 (provider, external_event_id) 가 이미 있으면 기존 row 반환.
 */
import { getSupabase } from "../lib/supabase";
import { AppError } from "../lib/errors";

export interface StoreWebhookInput {
  provider: string;
  eventType?: string;
  externalEventId?: string;
  tenantId?: string;
  payload: unknown;
}

export interface StoredWebhookEvent {
  id: string;
  alreadyExisted: boolean;
  processed: boolean;
}

export async function storeWebhookEvent(input: StoreWebhookInput): Promise<StoredWebhookEvent> {
  const supa = getSupabase();

  // 멱등: external_event_id 있으면 먼저 조회
  if (input.externalEventId) {
    const { data: existing, error: selErr } = await supa
      .from("webhook_events")
      .select("id, processed")
      .eq("provider", input.provider)
      .eq("external_event_id", input.externalEventId)
      .maybeSingle();
    if (selErr) {
      throw new AppError("DB_ERROR", `webhook lookup failed: ${selErr.message}`, 500);
    }
    if (existing) {
      return { id: String(existing.id), alreadyExisted: true, processed: Boolean(existing.processed) };
    }
  }

  const { data, error } = await supa
    .from("webhook_events")
    .insert({
      provider: input.provider,
      event_type: input.eventType ?? null,
      external_event_id: input.externalEventId ?? null,
      tenant_id: input.tenantId ?? null,
      payload: input.payload,
      processed: false,
    })
    .select("id, processed")
    .single();
  if (error) {
    // race: 다른 요청이 같은 external_event_id 로 먼저 insert 했을 수 있음
    if (/duplicate key|uq_webhook_events_external/i.test(error.message) && input.externalEventId) {
      const { data: existing2 } = await supa
        .from("webhook_events")
        .select("id, processed")
        .eq("provider", input.provider)
        .eq("external_event_id", input.externalEventId)
        .single();
      if (existing2) {
        return { id: String(existing2.id), alreadyExisted: true, processed: Boolean(existing2.processed) };
      }
    }
    throw new AppError("DB_ERROR", `webhook insert failed: ${error.message}`, 500);
  }
  return { id: String(data.id), alreadyExisted: false, processed: Boolean(data.processed) };
}

export async function markWebhookProcessed(eventId: string): Promise<void> {
  const supa = getSupabase();
  await supa.from("webhook_events").update({ processed: true, processed_at: new Date().toISOString() }).eq("id", eventId);
}

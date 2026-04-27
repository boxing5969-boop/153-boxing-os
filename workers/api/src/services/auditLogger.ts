import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeniedReason } from "@153/shared";

export interface LogEntry {
  branch_id: string;
  device_id: string | null;
  member_id: string | null;
  credential_type: "face" | "qr" | "card" | "pin" | "admin" | "visitor";
  result: "success" | "denied" | "error";
  denied_reason?: DeniedReason | null;
  raw_event_id?: string | null;
  occurred_at: string;
}

export async function appendAccessLog(
  db: SupabaseClient,
  entry: LogEntry
): Promise<string | null> {
  const { data, error } = await db
    .from("access_logs")
    .insert({
      branch_id: entry.branch_id,
      device_id: entry.device_id,
      member_id: entry.member_id,
      credential_type: entry.credential_type,
      result: entry.result,
      denied_reason: entry.denied_reason ?? null,
      raw_event_id: entry.raw_event_id ?? null,
      occurred_at: entry.occurred_at,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[appendAccessLog]", error);
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}

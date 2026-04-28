import { supabase } from "@/integrations/supabase/client";

export type AlertSeverity = "info" | "warning" | "critical";
export type AlertKind = "device_offline" | "device_error" | "sync_backlog";

export interface AlertRow {
  id: string;
  kind: AlertKind | string;
  severity: AlertSeverity | string;
  branch_id: string | null;
  device_id: string | null;
  subject: string;
  details: Record<string, unknown> | null;
  detected_at: string;
  notified_at: string | null;
  resolved_at: string | null;
}

export interface AlertListFilters {
  resolved?: boolean | null;
  severity?: AlertSeverity | null;
  limit?: number;
}

export async function listAlerts(filters: AlertListFilters = {}): Promise<AlertRow[]> {
  let query = supabase
    .from("alert_events")
    .select("*")
    .order("detected_at", { ascending: false })
    .limit(filters.limit ?? 100);

  if (filters.resolved === false) query = query.is("resolved_at", null);
  else if (filters.resolved === true) query = query.not("resolved_at", "is", null);
  if (filters.severity) query = query.eq("severity", filters.severity);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as AlertRow[];
}

export async function getUnresolvedAlertCount(): Promise<number> {
  const { count, error } = await supabase
    .from("alert_events")
    .select("id", { count: "exact", head: true })
    .is("resolved_at", null);
  if (error) throw error;
  return count ?? 0;
}

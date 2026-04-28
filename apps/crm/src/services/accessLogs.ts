import { supabase } from "@/integrations/supabase/client";
import type { AccessLog, AccessResult, CredentialType } from "@153/shared";

export interface AccessLogRow extends AccessLog {
  member_name?: string;
  device_name?: string;
  branch_name?: string;
}

export interface AccessLogFilters {
  branch_id?: string | null;
  member_id?: string | null;
  result?: AccessResult | null;
  credential_type?: CredentialType | null;
  denied_reason?: string | null;
  from?: string | null; // ISO
  to?: string | null;
  limit?: number;
  offset?: number;
}

export interface AccessLogListResult {
  rows: AccessLogRow[];
  total: number;
}

export async function listAccessLogs(
  filters: AccessLogFilters = {}
): Promise<AccessLogListResult> {
  const limit = filters.limit ?? 20;
  const offset = filters.offset ?? 0;

  let query = supabase
    .from("access_logs")
    .select(
      "*, member:members(name), device:access_devices(device_name), branch:branches(name)",
      { count: "exact" }
    )
    .order("occurred_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.branch_id) query = query.eq("branch_id", filters.branch_id);
  if (filters.member_id) query = query.eq("member_id", filters.member_id);
  if (filters.result) query = query.eq("result", filters.result);
  if (filters.credential_type) query = query.eq("credential_type", filters.credential_type);
  if (filters.denied_reason) query = query.eq("denied_reason", filters.denied_reason);
  if (filters.from) query = query.gte("occurred_at", filters.from);
  if (filters.to) query = query.lte("occurred_at", filters.to);

  const { data, error, count } = await query;
  if (error) throw error;

  type Joined = AccessLog & {
    member?: { name: string } | null;
    device?: { device_name: string } | null;
    branch?: { name: string } | null;
  };
  const rows = ((data ?? []) as unknown as Joined[]).map(
    ({ member, device, branch, ...log }) => ({
      ...log,
      member_name: member?.name,
      device_name: device?.device_name,
      branch_name: branch?.name,
    })
  );
  return { rows, total: count ?? 0 };
}

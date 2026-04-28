import { supabase } from "@/integrations/supabase/client";
import type { AccessDevice, DeviceStatus } from "@153/shared";

export interface DeviceRow extends AccessDevice {
  branch_name?: string;
}

export interface DeviceListFilters {
  branch_id?: string | null;
  status?: DeviceStatus | null;
}

export async function listDevices(filters: DeviceListFilters = {}): Promise<DeviceRow[]> {
  let query = supabase
    .from("access_devices")
    .select("*, branch:branches(name)")
    .order("device_name");

  if (filters.branch_id) query = query.eq("branch_id", filters.branch_id);
  if (filters.status) query = query.eq("status", filters.status);

  const { data, error } = await query;
  if (error) throw error;

  type Joined = AccessDevice & { branch?: { name: string } | null };
  return ((data ?? []) as unknown as Joined[]).map(({ branch, ...d }) => ({
    ...d,
    branch_name: branch?.name,
  }));
}

export interface ForceSyncResult {
  device_id: string;
  jobs_created: number;
  failed_reset: number;
  requested_at: string;
}

export async function forceDeviceSync(deviceId: string): Promise<ForceSyncResult> {
  const { data, error } = await supabase.rpc("force_device_sync", {
    _device_id: deviceId,
  });
  if (error) throw error;
  return data as unknown as ForceSyncResult;
}

export async function getDevicePendingCount(deviceIds: string[]): Promise<Record<string, number>> {
  if (deviceIds.length === 0) return {};
  const { data, error } = await supabase
    .from("device_sync_jobs")
    .select("device_id")
    .in("device_id", deviceIds)
    .in("status", ["pending", "failed"]);
  if (error) throw error;
  const map: Record<string, number> = {};
  for (const row of (data ?? []) as unknown as { device_id: string }[]) {
    map[row.device_id] = (map[row.device_id] ?? 0) + 1;
  }
  return map;
}

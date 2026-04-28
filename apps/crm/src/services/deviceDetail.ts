import { supabase } from "@/integrations/supabase/client";
import type { AccessDevice, AccessLog, DeviceSyncJob } from "@153/shared";

export interface DeviceWithBranch extends AccessDevice {
  branch_name?: string | null;
}

export interface DeviceDetailBundle {
  device: DeviceWithBranch | null;
  recent_logs: AccessLog[];
  recent_sync_jobs: DeviceSyncJob[];
}

export async function getDeviceDetail(deviceId: string): Promise<DeviceDetailBundle> {
  const [deviceRes, logsRes, jobsRes] = await Promise.all([
    supabase
      .from("access_devices")
      .select("*, branch:branches(name)")
      .eq("id", deviceId)
      .maybeSingle(),
    supabase
      .from("access_logs")
      .select("*")
      .eq("device_id", deviceId)
      .order("occurred_at", { ascending: false })
      .limit(20),
    supabase
      .from("device_sync_jobs")
      .select("*")
      .eq("device_id", deviceId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (deviceRes.error) throw deviceRes.error;
  if (logsRes.error) throw logsRes.error;
  if (jobsRes.error) throw jobsRes.error;

  type DeviceJoined = AccessDevice & { branch?: { name: string } | null };
  const raw = deviceRes.data as unknown as DeviceJoined | null;
  const device: DeviceWithBranch | null = raw
    ? { ...raw, branch_name: raw.branch?.name ?? null }
    : null;

  return {
    device,
    recent_logs: (logsRes.data ?? []) as unknown as AccessLog[],
    recent_sync_jobs: (jobsRes.data ?? []) as unknown as DeviceSyncJob[],
  };
}

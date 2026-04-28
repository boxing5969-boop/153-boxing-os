import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getAdapter,
  type AccessDeviceAdapter,
  type AdapterContext,
} from "@153/device-adapters";
import { getServiceClient } from "../lib/supabase";
import type { Env } from "../lib/env";

const MAX_RETRIES = 5;

interface PendingJob {
  id: string;
  branch_id: string;
  device_id: string;
  job_type: string;
  target_member_id: string | null;
  status: string;
  retry_count: number;
}

interface DeviceRow {
  id: string;
  branch_id: string;
  vendor: string;
  device_identifier: string | null;
  api_endpoint: string | null;
  status: string;
}

interface MemberRow {
  id: string;
  name: string;
  phone: string | null;
}

interface DeviceUserRow {
  vendor_user_id: string;
}

export interface ProcessReport {
  fetched: number;
  succeeded: number;
  failed: number;
}

export async function processNextSyncJobs(
  env: Env,
  limit = 50
): Promise<ProcessReport> {
  const db = getServiceClient(env);
  const { data, error } = await db
    .from("device_sync_jobs")
    .select("*")
    .eq("status", "pending")
    .lt("retry_count", MAX_RETRIES)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) {
    console.error("[syncQueue] fetch", error);
    return { fetched: 0, succeeded: 0, failed: 0 };
  }
  const list = (data ?? []) as unknown as PendingJob[];
  if (list.length === 0) return { fetched: 0, succeeded: 0, failed: 0 };

  let succeeded = 0;
  let failed = 0;
  for (const job of list) {
    const ok = await processOne(db, env, job);
    if (ok) succeeded++;
    else failed++;
  }
  return { fetched: list.length, succeeded, failed };
}

async function processOne(
  db: SupabaseClient,
  env: Env,
  job: PendingJob
): Promise<boolean> {
  // mark processing
  await db.from("device_sync_jobs").update({ status: "processing" }).eq("id", job.id);

  try {
    const { data: deviceRaw } = await db
      .from("access_devices")
      .select("id,branch_id,vendor,device_identifier,api_endpoint,status")
      .eq("id", job.device_id)
      .maybeSingle();
    const device = deviceRaw as DeviceRow | null;
    if (!device) throw new Error("device not found");

    const adapter = getAdapter(device.vendor);
    const ctx: AdapterContext = {
      device: {
        id: device.id,
        vendor: device.vendor,
        device_identifier: device.device_identifier,
        api_endpoint: device.api_endpoint,
      },
      device_api_key: env.DEVICE_API_KEY,
      base_url: device.api_endpoint ?? "",
    };

    let member: MemberRow | null = null;
    if (job.target_member_id) {
      const { data: m } = await db
        .from("members")
        .select("id,name,phone")
        .eq("id", job.target_member_id)
        .maybeSingle();
      member = m as MemberRow | null;
    }

    const vuid = await dispatchJob(db, adapter, ctx, job, member);

    // create_user 후 device_users 매핑 upsert
    if (job.job_type === "create_user" && member && vuid) {
      await db.from("device_users").upsert(
        {
          member_id: member.id,
          device_id: device.id,
          vendor_user_id: vuid,
          status: "active",
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "device_id,vendor_user_id" }
      );
    }

    // success
    await db
      .from("device_sync_jobs")
      .update({
        status: "success",
        processed_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", job.id);

    await db
      .from("access_devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", device.id);

    if (device.status === "error") {
      await db.from("access_devices").update({ status: "active" }).eq("id", device.id);
    }
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    const newRetry = job.retry_count + 1;
    const finalStatus = newRetry >= MAX_RETRIES ? "failed" : "pending";

    await db
      .from("device_sync_jobs")
      .update({
        status: finalStatus,
        retry_count: newRetry,
        error_message: msg,
      })
      .eq("id", job.id);

    if (newRetry >= MAX_RETRIES) {
      await db
        .from("access_devices")
        .update({ status: "error" })
        .eq("id", job.device_id);
      console.error(`[syncQueue] device ${job.device_id} → error after ${MAX_RETRIES} retries`);
    }
    return false;
  }
}

async function dispatchJob(
  db: SupabaseClient,
  adapter: AccessDeviceAdapter,
  ctx: AdapterContext,
  job: PendingJob,
  member: MemberRow | null
): Promise<string | undefined> {
  switch (job.job_type) {
    case "create_user": {
      if (!member) throw new Error("member required for create_user");
      return adapter.createUser(ctx, {
        id: member.id,
        name: member.name,
        phone: member.phone ?? undefined,
      });
    }
    case "update_user": {
      if (!member) throw new Error("member required for update_user");
      const vuid = await resolveVendorUserId(db, job.device_id, member.id);
      if (vuid) {
        await adapter.updateUser(
          ctx,
          { id: member.id, name: member.name, phone: member.phone ?? undefined },
          vuid
        );
        return vuid;
      }
      // 매핑이 없으면 createUser 로 폴백
      return adapter.createUser(ctx, {
        id: member.id,
        name: member.name,
        phone: member.phone ?? undefined,
      });
    }
    case "disable_user": {
      const vuid = await resolveVendorUserId(db, job.device_id, job.target_member_id);
      if (!vuid) return; // 매핑 없으면 no-op (이미 없으니 OK)
      await adapter.disableUser(ctx, vuid);
      return vuid;
    }
    case "delete_user": {
      const vuid = await resolveVendorUserId(db, job.device_id, job.target_member_id);
      if (!vuid) return;
      await adapter.deleteUser(ctx, vuid);
      // 매핑 row 삭제
      await db
        .from("device_users")
        .delete()
        .eq("device_id", job.device_id)
        .eq("vendor_user_id", vuid);
      return vuid;
    }
    case "sync_access_group": {
      const vuid = await resolveVendorUserId(db, job.device_id, job.target_member_id);
      if (!vuid) return;
      await adapter.assignAccessGroup(ctx, vuid, {
        group_id: ctx.device.id,
        name: "default",
      });
      return vuid;
    }
    case "pull_logs": {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await adapter.pullAccessLogs(ctx, since);
      return;
    }
    default:
      throw new Error(`Unknown job_type: ${job.job_type}`);
  }
}

async function resolveVendorUserId(
  db: SupabaseClient,
  deviceId: string,
  memberId: string | null
): Promise<string | null> {
  if (!memberId) return null;
  const { data } = await db
    .from("device_users")
    .select("vendor_user_id")
    .eq("device_id", deviceId)
    .eq("member_id", memberId)
    .maybeSingle();
  const row = data as DeviceUserRow | null;
  return row?.vendor_user_id ?? null;
}

export async function runDailyExpiry(env: Env): Promise<void> {
  const db = getServiceClient(env);
  const { data, error } = await db.rpc("expire_outdated_memberships");
  if (error) {
    console.error("[dailyExpiry]", error);
    return;
  }
  console.log("[dailyExpiry]", data);
}

export async function runQrCleanup(env: Env): Promise<void> {
  const db = getServiceClient(env);
  const { data, error } = await db.rpc("cleanup_qr_used_tokens");
  if (error) {
    console.error("[qrCleanup]", error);
    return;
  }
  console.log("[qrCleanup] removed:", data);
}

import { supabase } from "@/integrations/supabase/client";

export interface DashboardStats {
  todaySuccessCount: number;
  todayDeniedCount: number;
  expiringMembershipsCount: number; // 다음 7일 (오늘 포함)
  failedSyncJobsCount: number;
}

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const todayIso = startOfTodayIso();
  const today = new Date();
  const in7 = new Date();
  in7.setDate(in7.getDate() + 7);

  const [success, denied, expiring, failed] = await Promise.all([
    supabase
      .from("access_logs")
      .select("id", { count: "exact", head: true })
      .eq("result", "success")
      .gte("occurred_at", todayIso),
    supabase
      .from("access_logs")
      .select("id", { count: "exact", head: true })
      .eq("result", "denied")
      .gte("occurred_at", todayIso),
    supabase
      .from("memberships")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .gte("end_date", dateOnly(today))
      .lte("end_date", dateOnly(in7)),
    supabase
      .from("device_sync_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed"),
  ]);

  return {
    todaySuccessCount: success.count ?? 0,
    todayDeniedCount: denied.count ?? 0,
    expiringMembershipsCount: expiring.count ?? 0,
    failedSyncJobsCount: failed.count ?? 0,
  };
}

import { supabase } from "@/integrations/supabase/client";

export interface DashboardStats {
  todaySuccessCount: number;
  todayDeniedCount: number;
  expiringMembershipsCount: number; // 다음 7일 (오늘 포함)
  failedSyncJobsCount: number;
  unpaidMembersCount: number;        // 미납 회원 수
  // ── 센터 운영 OS Phase 1 추가 ──────────────────────────
  todayNewMembersCount: number;              // 오늘 신규 등록 회원
  pendingVisitorCount: number;               // 방문 신청 대기
  pendingScheduledMessagesCount: number;     // 예약 발송 대기
  dueFollowupsCount: number;                 // 상담 팔로업 예정 (오늘까지)
}

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function endOfTodayIso(): string {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const todayIso = startOfTodayIso();
  const endTodayIso = endOfTodayIso();
  const today = new Date();
  const in7 = new Date();
  in7.setDate(in7.getDate() + 7);

  const [
    success,
    denied,
    expiring,
    failed,
    unpaid,
    newMembers,
    pendingVisitors,
    pendingMsgs,
    dueFollowups,
  ] = await Promise.all([
    // ── 기존 5개 ──────────────────────────────────────────
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
    supabase
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("status", "unpaid"),
    // ── 센터 운영 OS Phase 1 추가 4개 ────────────────────
    // 오늘 신규 등록 회원
    supabase
      .from("members")
      .select("id", { count: "exact", head: true })
      .gte("created_at", todayIso),
    // 방문 신청 대기 (status = 'requested')
    supabase
      .from("visitor_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "requested"),
    // 예약 발송 대기 (status = 'pending')
    supabase
      .from("scheduled_messages")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    // 상담 팔로업 예정 (next_followup_at <= 오늘 23:59:59)
    supabase
      .from("consultation_notes")
      .select("id", { count: "exact", head: true })
      .lte("next_followup_at", endTodayIso)
      .not("next_followup_at", "is", null),
  ]);

  return {
    todaySuccessCount: success.count ?? 0,
    todayDeniedCount: denied.count ?? 0,
    expiringMembershipsCount: expiring.count ?? 0,
    failedSyncJobsCount: failed.count ?? 0,
    unpaidMembersCount: unpaid.count ?? 0,
    todayNewMembersCount: newMembers.count ?? 0,
    pendingVisitorCount: pendingVisitors.count ?? 0,
    pendingScheduledMessagesCount: pendingMsgs.count ?? 0,
    dueFollowupsCount: dueFollowups.count ?? 0,
  };
}

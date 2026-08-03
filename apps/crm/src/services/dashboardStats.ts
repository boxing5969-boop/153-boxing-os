import { supabase } from "@/integrations/supabase/client";

/**
 * 홈 대시보드 — 운영 액션 카운트만 담당.
 * 검수 반영(boxer): 핵심 숫자(출입·신규·미납·만료예정)는 브로제이 명부 기준
 * 통합 집계(reportAutoStats.getAutoStats — 워커 /api/reports/auto-stats)로 이관했다.
 * 여기 남은 것은 TodayActionStrip 용 3개뿐 — 안 쓰는 count 쿼리 6개는 제거(주기 낭비 방지).
 */
export interface DashboardStats {
  pendingVisitorCount: number;               // 방문 신청 대기
  pendingScheduledMessagesCount: number;     // 예약 발송 대기
  dueFollowupsCount: number;                 // 상담 팔로업 예정 (오늘까지)
}

// KST 자정 앵커 — reportAutoStats 와 동일 방식
function kstDay(offsetDays = 0): string {
  return new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000)
    .toISOString().slice(0, 10);
}

function endOfTodayIso(): string {
  return `${kstDay(0)}T23:59:59+09:00`;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const endTodayIso = endOfTodayIso();

  const [pendingVisitors, pendingMsgs, dueFollowups] = await Promise.all([
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
    pendingVisitorCount: pendingVisitors.count ?? 0,
    pendingScheduledMessagesCount: pendingMsgs.count ?? 0,
    dueFollowupsCount: dueFollowups.count ?? 0,
  };
}

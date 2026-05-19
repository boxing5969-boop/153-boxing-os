/**
 * 코치 업무보드 데이터 서비스
 * - 모든 쿼리는 RLS(is_coach_of)에 의해 담당 회원만 자동 필터됨
 * - DB 변경 없음, Workers API 불필요
 */
import { supabase } from "@/integrations/supabase/client";

// ── 1. 담당 활성 회원 수 ─────────────────────────────────────
export async function getMyMemberCount(): Promise<number> {
  const { count, error } = await supabase
    .from("members")
    .select("id", { count: "exact", head: true })
    .in("status", ["active", "trial"]);
  if (error) throw error;
  return count ?? 0;
}

// ── 2. 14일 이상 미출석 담당 회원 ───────────────────────────
export interface AbsentMemberRow {
  member_id: string;
  member_name: string;
  last_seen_date: string | null; // YYYY-MM-DD
  days_absent: number;
}

export async function getMyAbsentMembers(): Promise<AbsentMemberRow[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);
  const cutoffIso = cutoff.toISOString();

  // 담당 활성 회원 (RLS 자동 필터)
  const { data: members, error: mErr } = await supabase
    .from("members")
    .select("id, name")
    .eq("status", "active");
  if (mErr) throw mErr;
  if (!members || members.length === 0) return [];

  const memberIds = (members as { id: string; name: string }[]).map((m) => m.id);

  // 담당 회원 최근 출입 성공 기록 (coach access_logs RLS 적용)
  const { data: logs, error: lErr } = await supabase
    .from("access_logs")
    .select("member_id, occurred_at")
    .in("member_id", memberIds)
    .eq("result", "success")
    .order("occurred_at", { ascending: false });
  if (lErr) throw lErr;

  // member_id별 최근 출입일
  const lastSeen: Record<string, string> = {};
  for (const log of (logs ?? []) as { member_id: string; occurred_at: string }[]) {
    if (!lastSeen[log.member_id]) lastSeen[log.member_id] = log.occurred_at;
  }

  const today = Date.now();
  const result: AbsentMemberRow[] = [];

  for (const m of members as { id: string; name: string }[]) {
    const last = lastSeen[m.id] ?? null;
    if (!last || last < cutoffIso) {
      const daysAbsent = last
        ? Math.floor((today - new Date(last).getTime()) / 86_400_000)
        : 999;
      result.push({
        member_id: m.id,
        member_name: m.name,
        last_seen_date: last ? last.slice(0, 10) : null,
        days_absent: daysAbsent,
      });
    }
  }

  return result.sort((a, b) => b.days_absent - a.days_absent).slice(0, 20);
}

// ── 3. 레벨테스트 진행 중 담당 회원 ─────────────────────────
export interface LevelInProgressRow {
  member_id: string;
  member_name: string;
  tier: string;
  level: number;
}

export async function getMyLevelInProgressMembers(): Promise<LevelInProgressRow[]> {
  const { data, error } = await supabase
    .from("level_progress")
    .select("member_id, tier, level, members(name)")
    .eq("status", "in_progress")
    .order("tier")
    .order("level");
  if (error) throw error;

  type Joined = {
    member_id: string;
    tier: string;
    level: number;
    members?: { name: string } | null;
  };
  return ((data ?? []) as unknown as Joined[]).map((r) => ({
    member_id: r.member_id,
    member_name: r.members?.name ?? "—",
    tier: r.tier,
    level: r.level,
  }));
}

// ── 4. 체성분 30일 미기록 담당 회원 ─────────────────────────
export interface MissingMeasurementRow {
  member_id: string;
  member_name: string;
  last_measured_date: string | null; // YYYY-MM-DD
}

export async function getMyMissingMeasurementMembers(): Promise<MissingMeasurementRow[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const { data: members, error: mErr } = await supabase
    .from("members")
    .select("id, name")
    .eq("status", "active");
  if (mErr) throw mErr;
  if (!members || members.length === 0) return [];

  const memberIds = (members as { id: string }[]).map((m) => m.id);

  const { data: measurements, error: measErr } = await supabase
    .from("body_measurements")
    .select("member_id, measured_at")
    .in("member_id", memberIds)
    .order("measured_at", { ascending: false });
  if (measErr) throw measErr;

  const lastMeasured: Record<string, string> = {};
  for (const meas of (measurements ?? []) as { member_id: string; measured_at: string }[]) {
    if (!lastMeasured[meas.member_id])
      lastMeasured[meas.member_id] = meas.measured_at.slice(0, 10);
  }

  const result: MissingMeasurementRow[] = [];
  for (const m of members as { id: string; name: string }[]) {
    const last = lastMeasured[m.id] ?? null;
    if (!last || last < cutoffDate) {
      result.push({ member_id: m.id, member_name: m.name, last_measured_date: last });
    }
  }
  return result.slice(0, 20);
}

// ── 5. 상담 팔로업 오늘까지 예정 담당 회원 ──────────────────
export interface FollowupRow {
  id: string;
  member_id: string;
  member_name: string;
  next_followup_at: string;
  note: string | null;
}

export async function getMyDueFollowups(): Promise<FollowupRow[]> {
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const { data, error } = await supabase
    .from("consultation_notes")
    .select("id, member_id, note, next_followup_at, members(name)")
    .not("next_followup_at", "is", null)
    .lte("next_followup_at", todayEnd.toISOString())
    .order("next_followup_at", { ascending: true })
    .limit(20);
  if (error) throw error;

  type Joined = {
    id: string;
    member_id: string;
    note: string | null;
    next_followup_at: string;
    members?: { name: string } | null;
  };
  return ((data ?? []) as unknown as Joined[]).map((r) => ({
    id: r.id,
    member_id: r.member_id,
    member_name: r.members?.name ?? "—",
    next_followup_at: r.next_followup_at,
    note: r.note,
  }));
}

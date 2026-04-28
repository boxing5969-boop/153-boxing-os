import { supabase } from "@/integrations/supabase/client";
import type { MemberStatus } from "@153/shared";

export interface KioskCandidate {
  id: string;
  name: string;
  phone: string | null;
  status: MemberStatus;
}

export interface KioskSummary {
  member_id: string;
  name: string;
  status: MemberStatus;
  can_enter: boolean;
  cannot_enter_reason: string | null;
  plan_name: string | null;
  days_remaining: number | null;
  trial_uses_remaining: number | null;
  last_visit_at: string | null;
  last_visit_result: "success" | "denied" | "error" | null;
}

interface MembershipRow {
  plan_name: string;
  end_date: string;
  status: string;
  payment_status: string;
}
interface TrialRow {
  end_at: string;
  used_entries: number;
  max_entries: number;
  status: string;
}
interface AccessLogRow {
  occurred_at: string;
  result: "success" | "denied" | "error";
}

/**
 * 휴대폰 마지막 N자리(또는 전체)로 회원 검색.
 * RLS 가 호출자 권한 범위 내에서만 결과 반환 (branch_admin 자기 지점 / hq 전체).
 */
export async function lookupKioskMembers(
  phoneSuffix: string,
  limit = 5
): Promise<KioskCandidate[]> {
  const trimmed = phoneSuffix.trim();
  if (trimmed.length < 4) return [];
  const escaped = trimmed.replace(/[%_]/g, "\\$&");

  const { data, error } = await supabase
    .from("members")
    .select("id, name, phone, status")
    .ilike("phone", `%${escaped}`)
    .neq("status", "withdrawn")
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as KioskCandidate[];
}

export async function getKioskSummary(memberId: string): Promise<KioskSummary> {
  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  const [memberRes, msRes, tpRes, logRes] = await Promise.all([
    supabase
      .from("members")
      .select("id, name, status")
      .eq("id", memberId)
      .single(),
    supabase
      .from("memberships")
      .select("plan_name,end_date,status,payment_status")
      .eq("member_id", memberId)
      .eq("status", "active")
      .gte("end_date", today)
      .order("end_date", { ascending: false })
      .limit(1),
    supabase
      .from("trial_passes")
      .select("end_at,used_entries,max_entries,status")
      .eq("member_id", memberId)
      .eq("status", "active")
      .gte("end_at", nowIso)
      .order("end_at", { ascending: false })
      .limit(1),
    supabase
      .from("access_logs")
      .select("occurred_at,result")
      .eq("member_id", memberId)
      .order("occurred_at", { ascending: false })
      .limit(1),
  ]);
  if (memberRes.error) throw memberRes.error;

  const member = memberRes.data as { id: string; name: string; status: MemberStatus };
  const ms = ((msRes.data ?? []) as unknown as MembershipRow[]).find(
    (m) => m.payment_status === "paid" || m.payment_status === "partial"
  );
  const tp = ((tpRes.data ?? []) as unknown as TrialRow[]).find(
    (t) => t.used_entries < t.max_entries
  );
  const last = ((logRes.data ?? []) as unknown as AccessLogRow[])[0] ?? null;

  let canEnter = false;
  let cannotEnterReason: string | null = null;
  let planName: string | null = null;
  let daysRemaining: number | null = null;
  let trialUsesRemaining: number | null = null;

  if (member.status === "expired") {
    cannotEnterReason = "이용권 만료";
  } else if (member.status === "unpaid") {
    cannotEnterReason = "미납 상태";
  } else if (member.status === "suspended") {
    cannotEnterReason = "정지 상태";
  } else if (ms) {
    canEnter = true;
    planName = ms.plan_name;
    const endTs = new Date(ms.end_date).getTime();
    daysRemaining = Math.max(0, Math.ceil((endTs - Date.now()) / 86_400_000));
  } else if (tp) {
    canEnter = true;
    planName = "체험권";
    trialUsesRemaining = tp.max_entries - tp.used_entries;
  } else {
    cannotEnterReason = "유효한 이용권 없음";
  }

  return {
    member_id: member.id,
    name: member.name,
    status: member.status,
    can_enter: canEnter,
    cannot_enter_reason: cannotEnterReason,
    plan_name: planName,
    days_remaining: daysRemaining,
    trial_uses_remaining: trialUsesRemaining,
    last_visit_at: last?.occurred_at ?? null,
    last_visit_result: last?.result ?? null,
  };
}

/** UI 노출용 마스킹: 첫 글자 + 별표 */
export function maskName(name: string): string {
  if (!name) return "—";
  if (name.length === 1) return name + "*";
  return name.charAt(0) + "*".repeat(Math.max(1, name.length - 1));
}

/** UI 노출용 마스킹: 가운데 4자리 별표 (010-****-5678) */
export function maskPhone(phone: string | null): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return phone;
  const head = digits.slice(0, 3);
  const tail = digits.slice(-4);
  return `${head}-****-${tail}`;
}

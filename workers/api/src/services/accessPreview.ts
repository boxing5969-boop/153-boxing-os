import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeniedReason } from "@153/shared";

export type PreviewSource = "grant" | "membership" | "trial";

export type PreviewDecision =
  | { allowed: true; member_id: string; member_name: string; source: PreviewSource }
  | { allowed: false; member_id: string | null; reason: DeniedReason };

interface MemberRow {
  id: string;
  name: string;
  branch_id: string;
  status: "active" | "trial" | "expired" | "suspended" | "unpaid" | "withdrawn";
}
interface MembershipRow {
  id: string;
  status: string;
  end_date: string;
  payment_status: string;
}
interface TrialPassRow {
  id: string;
  status: string;
  end_at: string;
  max_entries: number;
  used_entries: number;
}
interface GrantRow {
  id: string;
  grant_type: string;
  valid_until: string | null;
  status: string;
}

/**
 * 회원 1명의 현재 출입 가능 여부를 권위 기준으로 판정한다.
 * - side-effect 없음 (access_logs 기록 X, QR consume X, trial counter ++ X)
 * - device/credential 분기는 사용하지 않음 (verify 흐름 전용)
 * - branch_id 가 명시되면 해당 지점 기준으로 평가, 없으면 member 의 소속 지점 사용
 */
export async function previewAccessForMember(
  db: SupabaseClient,
  memberId: string,
  branchIdHint?: string,
): Promise<PreviewDecision> {
  const { data: memberData } = await db
    .from("members")
    .select("id,name,branch_id,status")
    .eq("id", memberId)
    .maybeSingle();
  const member = memberData as MemberRow | null;
  if (!member) {
    return { allowed: false, member_id: null, reason: "unknown_user" };
  }

  const branchId = branchIdHint ?? member.branch_id;

  if (member.status === "expired") {
    return { allowed: false, member_id: member.id, reason: "expired_membership" };
  }
  if (member.status === "unpaid") {
    return { allowed: false, member_id: member.id, reason: "unpaid" };
  }
  if (member.status === "suspended") {
    return { allowed: false, member_id: member.id, reason: "suspended" };
  }
  if (member.status === "withdrawn") {
    return { allowed: false, member_id: null, reason: "unknown_user" };
  }

  const nowIso = new Date().toISOString();

  const { data: grantsData } = await db
    .from("access_grants")
    .select("id,grant_type,valid_until,status")
    .eq("member_id", member.id)
    .eq("branch_id", branchId)
    .eq("status", "active");
  const grants = (grantsData ?? []) as GrantRow[];
  const hasActiveGrant = grants.some((g) => !g.valid_until || g.valid_until > nowIso);
  if (hasActiveGrant) {
    return { allowed: true, member_id: member.id, member_name: member.name, source: "grant" };
  }

  const today = nowIso.slice(0, 10);
  const { data: msData } = await db
    .from("memberships")
    .select("id,status,end_date,payment_status")
    .eq("member_id", member.id)
    .eq("status", "active")
    .gte("end_date", today);
  const memberships = (msData ?? []) as MembershipRow[];
  const hasPaidMembership = memberships.some(
    (m) => m.payment_status === "paid" || m.payment_status === "partial",
  );
  if (hasPaidMembership) {
    return { allowed: true, member_id: member.id, member_name: member.name, source: "membership" };
  }

  const { data: tpData } = await db
    .from("trial_passes")
    .select("id,status,end_at,max_entries,used_entries")
    .eq("member_id", member.id)
    .eq("status", "active")
    .gte("end_at", nowIso);
  const trials = (tpData ?? []) as TrialPassRow[];
  const usableTrial = trials.find((t) => t.used_entries < t.max_entries);
  if (usableTrial) {
    return { allowed: true, member_id: member.id, member_name: member.name, source: "trial" };
  }
  if (trials.length > 0) {
    return { allowed: false, member_id: member.id, reason: "trial_max_used" };
  }

  return { allowed: false, member_id: member.id, reason: "no_valid_grant" };
}

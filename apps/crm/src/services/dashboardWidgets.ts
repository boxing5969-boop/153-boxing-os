import { supabase } from "@/integrations/supabase/client";
import type { DeniedReason } from "@153/shared";

export interface ExpiringMembershipRow {
  id: string;
  member_id: string;
  member_name: string;
  plan_name: string;
  end_date: string;
  days_remaining: number;
}

export async function listExpiringMemberships(
  days: number = 7,
  limit: number = 20
): Promise<ExpiringMembershipRow[]> {
  const today = new Date();
  const end = new Date();
  end.setDate(end.getDate() + days);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("memberships")
    .select("id, member_id, plan_name, end_date, members(name)")
    .eq("status", "active")
    .gte("end_date", fmt(today))
    .lte("end_date", fmt(end))
    .order("end_date", { ascending: true })
    .limit(limit);
  if (error) throw error;

  type Joined = {
    id: string;
    member_id: string;
    plan_name: string;
    end_date: string;
    members?: { name: string } | null;
  };

  return ((data ?? []) as unknown as Joined[]).map((m) => {
    const endTs = new Date(m.end_date).getTime();
    const remaining = Math.max(0, Math.ceil((endTs - today.getTime()) / 86_400_000));
    return {
      id: m.id,
      member_id: m.member_id,
      member_name: m.members?.name ?? "—",
      plan_name: m.plan_name,
      end_date: m.end_date,
      days_remaining: remaining,
    };
  });
}

// ── 이탈 위험 회원 (AtRiskMembersCard + ContactActionBoard 공유) ──
export type AtRiskType = "unpaid" | "expired" | "absent";

export interface AtRiskMember {
  member_id: string;
  member_name: string;
  member_phone: string | null;
  risk_type: AtRiskType;
  detail: string;
  since_date: string;
}

export async function getAtRiskMembers(branchId: string): Promise<AtRiskMember[]> {
  const { data, error } = await supabase.rpc("get_at_risk_members", {
    _branch_id: branchId,
  });
  if (error) throw error;
  return (data ?? []) as AtRiskMember[];
}

export interface DeniedReasonStat {
  denied_reason: DeniedReason | string;
  count: number;
}

export async function getDeniedReasonStats(days: number = 7): Promise<DeniedReasonStat[]> {
  const { data, error } = await supabase.rpc("get_denied_reason_stats", { _days: days });
  if (error) throw error;
  return ((data ?? []) as unknown as { denied_reason: string; count: number | string }[]).map(
    (r) => ({
      denied_reason: r.denied_reason,
      count: typeof r.count === "string" ? parseInt(r.count, 10) : r.count,
    })
  );
}

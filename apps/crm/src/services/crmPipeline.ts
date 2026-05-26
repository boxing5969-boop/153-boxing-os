/**
 * CRM 8단계 파이프라인 클라이언트.
 * - Supabase 직접 SELECT (RLS 가 tenant + branch 격리)
 * - stage 변경은 move_member_stage RPC (권한 검증 내장)
 */
import { supabase } from "@/integrations/supabase/client";

export const STAGES = [
  "stage_1",
  "stage_2",
  "stage_3",
  "stage_4",
  "stage_5_intensive",
  "stage_5_normal",
  "stage_6",
  "stage_7",
  "stage_8",
] as const;
export type CrmStage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<CrmStage, string> = {
  stage_1: "신규 유입",
  stage_2: "체험권 구매",
  stage_3: "첫 수업 예약",
  stage_4: "체험 만료 D-3",
  stage_5_intensive: "신규 회원 (집중 케어)",
  stage_5_normal: "회원 (일반 관리)",
  stage_6: "회원권 D-14",
  stage_7: "이탈",
  stage_8: "장기 미출석",
};

export interface MemberCard {
  id: string;
  name: string;
  phone: string;
  branch_id: string;
  branch_name?: string;
  crm_stage: CrmStage;
  churn_reason: "trial_not_purchased" | "trial_dropped" | "membership_expired" | null;
  stage_changed_at: string;
  intensive_until: string | null;
  status: string;
  // 보조 데이터 — 표시용
  active_trial_end?: string;
  active_membership_end?: string;
  last_access_at?: string;
}

export interface StageLog {
  id: string;
  member_id: string;
  from_stage: string | null;
  to_stage: string;
  reason: string | null;
  source: string;
  changed_by: string | null;
  changed_at: string;
}

/**
 * 회원 + 보조 데이터 로드. RLS 가 tenant 격리, 추가로 branchId 지정 시 그쪽만.
 * limit 500 (한 화면 8 컬럼 × 60건 가정).
 */
export async function listMembersForPipeline(opts: {
  branchId?: string;
  limit?: number;
}): Promise<MemberCard[]> {
  const { branchId, limit = 500 } = opts;
  let q = supabase
    .from("members")
    .select(
      "id, name, phone, branch_id, status, crm_stage, churn_reason, stage_changed_at, intensive_until, branches:branch_id(name)"
    )
    .is("deleted_at" as never, null)  // 어떤 스키마에선 deleted_at 없을 수 있음 — TS만 우회
    .order("stage_changed_at", { ascending: false })
    .limit(limit);
  if (branchId) q = q.eq("branch_id", branchId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  type Row = {
    id: string;
    name: string;
    phone: string;
    branch_id: string;
    status: string;
    crm_stage: CrmStage;
    churn_reason: MemberCard["churn_reason"];
    stage_changed_at: string;
    intensive_until: string | null;
    branches: { name: string } | { name: string }[] | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    branch_id: r.branch_id,
    branch_name: Array.isArray(r.branches) ? r.branches[0]?.name : r.branches?.name,
    crm_stage: r.crm_stage,
    churn_reason: r.churn_reason,
    stage_changed_at: r.stage_changed_at,
    intensive_until: r.intensive_until,
    status: r.status,
  }));
}

/** Stage 변경 — service_role 이 아닌 authenticated 도 호출 가능. RPC 내부에서 권한 검증. */
export async function moveMemberStage(input: {
  memberId: string;
  toStage: CrmStage;
  reason?: string;
}): Promise<StageLog | null> {
  const { data, error } = await supabase.rpc("move_member_stage", {
    p_member_id: input.memberId,
    p_to_stage: input.toStage,
    p_reason: input.reason ?? null,
    p_source: "manual",
  });
  if (error) throw new Error(error.message);
  // 멱등 — 같은 stage 면 null
  return (data as unknown as StageLog) ?? null;
}

export async function listStageLogs(memberId: string, limit = 30): Promise<StageLog[]> {
  const { data, error } = await supabase
    .from("crm_stage_logs")
    .select("id, member_id, from_stage, to_stage, reason, source, changed_by, changed_at")
    .eq("member_id", memberId)
    .order("changed_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as StageLog[]) ?? [];
}

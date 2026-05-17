import { supabase } from "@/integrations/supabase/client";

export interface BranchPlanPreset {
  id: string;
  branch_id: string;
  name: string;
  days: number;
  price: number;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreatePresetInput {
  branch_id: string;
  name: string;
  days: number;
  price: number;
  description?: string;
}

export interface UpdatePresetInput {
  name?: string;
  days?: number;
  price?: number;
  description?: string | null;
  is_active?: boolean;
  sort_order?: number;
}

/** 지점의 활성 플랜 프리셋 목록 조회 */
export async function listBranchPlanPresets(
  branchId: string,
  includeInactive = false
): Promise<BranchPlanPreset[]> {
  let query = supabase
    .from("branch_plan_presets")
    .select("*")
    .eq("branch_id", branchId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (!includeInactive) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as BranchPlanPreset[];
}

/** 프리셋 생성 */
export async function createBranchPlanPreset(
  input: CreatePresetInput
): Promise<BranchPlanPreset> {
  // sort_order: 현재 최대값 + 1
  const { count } = await supabase
    .from("branch_plan_presets")
    .select("id", { count: "exact", head: true })
    .eq("branch_id", input.branch_id);

  const { data, error } = await supabase
    .from("branch_plan_presets")
    .insert({
      branch_id:   input.branch_id,
      name:        input.name.trim(),
      days:        input.days,
      price:       input.price,
      description: input.description?.trim() || null,
      sort_order:  count ?? 0,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as unknown as BranchPlanPreset;
}

/** 프리셋 수정 */
export async function updateBranchPlanPreset(
  id: string,
  patch: UpdatePresetInput
): Promise<BranchPlanPreset> {
  const { data, error } = await supabase
    .from("branch_plan_presets")
    .update({
      ...(patch.name !== undefined      && { name:        patch.name.trim() }),
      ...(patch.days !== undefined      && { days:        patch.days }),
      ...(patch.price !== undefined     && { price:       patch.price }),
      ...(patch.description !== undefined && { description: patch.description?.trim() || null }),
      ...(patch.is_active !== undefined && { is_active:   patch.is_active }),
      ...(patch.sort_order !== undefined && { sort_order:  patch.sort_order }),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as unknown as BranchPlanPreset;
}

/** 프리셋 비활성화 (소프트 삭제) */
export async function deactivateBranchPlanPreset(id: string): Promise<void> {
  const { error } = await supabase
    .from("branch_plan_presets")
    .update({ is_active: false })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** 프리셋 순서 일괄 변경 */
export async function reorderBranchPlanPresets(
  orderedIds: string[]
): Promise<void> {
  const updates = orderedIds.map((id, i) =>
    supabase
      .from("branch_plan_presets")
      .update({ sort_order: i })
      .eq("id", id)
  );
  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
}

import { supabase } from "@/integrations/supabase/client";
import type { LevelProgress, LevelStatus, LevelTier } from "@153/shared";

export async function listMemberLevels(memberId: string): Promise<LevelProgress[]> {
  const { data, error } = await supabase
    .from("level_progress")
    .select("*")
    .eq("member_id", memberId)
    .order("tier")
    .order("level");
  if (error) throw error;
  return (data ?? []) as unknown as LevelProgress[];
}

export interface UpsertLevelInput {
  member_id: string;
  tier: LevelTier;
  level: number;
  status: LevelStatus;
  approved_by?: string | null;
}

export async function upsertLevelProgress(input: UpsertLevelInput): Promise<LevelProgress> {
  // 기존 row 확인
  const { data: existing } = await supabase
    .from("level_progress")
    .select("id")
    .eq("member_id", input.member_id)
    .eq("tier", input.tier)
    .eq("level", input.level)
    .maybeSingle();
  const existingRow = existing as { id: string } | null;

  const tested_at = input.status === "passed" || input.status === "failed"
    ? new Date().toISOString()
    : null;

  if (existingRow) {
    const { data, error } = await supabase
      .from("level_progress")
      .update({
        status: input.status,
        approved_by: input.approved_by ?? null,
        tested_at,
      })
      .eq("id", existingRow.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as unknown as LevelProgress;
  }

  const { data, error } = await supabase
    .from("level_progress")
    .insert({
      member_id: input.member_id,
      tier: input.tier,
      level: input.level,
      status: input.status,
      approved_by: input.approved_by ?? null,
      tested_at,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as LevelProgress;
}

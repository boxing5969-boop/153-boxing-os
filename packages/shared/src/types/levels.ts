export type LevelTier = "white" | "blue" | "red" | "black";
export type LevelStatus = "not_started" | "in_progress" | "passed" | "failed";

export interface LevelProgress {
  id: string;
  member_id: string;
  tier: LevelTier;
  level: number;
  status: LevelStatus;
  tested_at: string | null;
  approved_by: string | null;
  created_at: string;
}

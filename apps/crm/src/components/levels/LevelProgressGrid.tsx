import { useMemo } from "react";
import { errorMessage } from "@/lib/errors";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { LevelProgress, LevelStatus, LevelTier } from "@153/shared";
import { upsertLevelProgress } from "@/services/levels";
import { cn } from "@/lib/cn";

const TIERS: LevelTier[] = ["white", "blue", "red", "black"];
const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

const TIER_LABELS: Record<LevelTier, string> = {
  white: "White",
  blue: "Blue",
  red: "Red",
  black: "Black",
};

const TIER_COLORS: Record<LevelTier, string> = {
  white: "bg-gray-50 text-gray-800",
  blue: "bg-blue-50 text-blue-800",
  red: "bg-red-50 text-red-800",
  black: "bg-zinc-900 text-white",
};

const STATUS_BG: Record<LevelStatus, string> = {
  not_started: "bg-background",
  in_progress: "bg-yellow-50",
  passed: "bg-green-50",
  failed: "bg-red-50",
};

const STATUS_LABELS: Record<LevelStatus, string> = {
  not_started: "미시작",
  in_progress: "진행",
  passed: "통과",
  failed: "실패",
};

interface Props {
  memberId: string;
  rows: LevelProgress[];
  approvedBy?: string | null;
}

export function LevelProgressGrid({ memberId, rows, approvedBy }: Props) {
  const qc = useQueryClient();
  const map = useMemo(() => {
    const m = new Map<string, LevelProgress>();
    for (const r of rows) m.set(`${r.tier}-${r.level}`, r);
    return m;
  }, [rows]);

  const mutation = useMutation({
    mutationFn: upsertLevelProgress,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["levels", memberId] });
    },
  });

  function handleChange(tier: LevelTier, level: number, status: LevelStatus) {
    mutation.mutate({
      member_id: memberId,
      tier,
      level,
      status,
      approved_by: approvedBy ?? null,
    });
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="px-2 py-2 text-left text-xs uppercase opacity-60">티어</th>
            {LEVELS.map((l) => (
              <th key={l} className="px-2 py-2 text-center text-xs opacity-60">
                Lv{l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {TIERS.map((tier) => (
            <tr key={tier}>
              <td className="px-2 py-2">
                <span
                  className={cn(
                    "inline-block rounded px-2 py-1 text-xs font-medium",
                    TIER_COLORS[tier]
                  )}
                >
                  {TIER_LABELS[tier]}
                </span>
              </td>
              {LEVELS.map((level) => {
                const cell = map.get(`${tier}-${level}`);
                const status = cell?.status ?? "not_started";
                return (
                  <td key={level} className={cn("px-1 py-1", STATUS_BG[status])}>
                    <select
                      value={status}
                      onChange={(e) =>
                        handleChange(tier, level, e.target.value as LevelStatus)
                      }
                      disabled={mutation.isPending}
                      className="w-full rounded border border-foreground/10 bg-transparent px-1 py-1 text-xs"
                      aria-label={`${tier} Lv${level}`}
                    >
                      {(Object.keys(STATUS_LABELS) as LevelStatus[]).map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {mutation.isError && (
        <p className="mt-2 text-xs text-red-600">
          저장 실패:{" "}
          {errorMessage(mutation.error)}
        </p>
      )}
    </div>
  );
}

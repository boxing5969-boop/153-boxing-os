import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { getDeniedReasonStats } from "@/services/dashboardWidgets";
import { DENIED_REASON_LABELS, type DeniedReason } from "@153/shared";

export function DeniedReasonsCard({ days = 7 }: { days?: number }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard-denied-stats", days],
    queryFn: () => getDeniedReasonStats(days),
    staleTime: 60_000,
  });

  const total = useMemo(
    () => (data ?? []).reduce((acc, r) => acc + r.count, 0),
    [data]
  );
  const max = useMemo(
    () => Math.max(1, ...(data ?? []).map((r) => r.count)),
    [data]
  );

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold opacity-80">
          최근 {days}일 거절 사유 분포
        </h2>
        <p className="text-xs opacity-60 mt-0.5">총 {total}건</p>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm opacity-60">로딩 중…</p>}
        {isError && (
          <p className="text-sm text-red-600">
            오류: {error instanceof Error ? error.message : "알 수 없는 오류"}
          </p>
        )}
        {!isLoading && !isError && (data?.length ?? 0) === 0 && (
          <p className="text-sm opacity-60">거절 기록이 없습니다.</p>
        )}
        {(data?.length ?? 0) > 0 && (
          <ul className="space-y-2">
            {(data ?? []).map((r) => {
              const pct = (r.count / max) * 100;
              const totalPct = total === 0 ? 0 : (r.count / total) * 100;
              const label =
                DENIED_REASON_LABELS[r.denied_reason as DeniedReason] ??
                r.denied_reason;
              return (
                <li key={r.denied_reason} className="text-sm">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="truncate">{label}</span>
                    <span className="opacity-70 text-xs whitespace-nowrap">
                      {r.count}건 · {totalPct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-foreground/10 overflow-hidden">
                    <div
                      className="h-full bg-red-400"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

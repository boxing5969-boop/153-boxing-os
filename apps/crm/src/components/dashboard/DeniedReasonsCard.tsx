import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldX, CheckCircle2 } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { getDeniedReasonStats } from "@/services/dashboardWidgets";
import { DENIED_REASON_LABELS, type DeniedReason } from "@153/shared";
import { cn } from "@/lib/cn";

const REASON_COLORS = [
  "bg-danger",
  "bg-warning",
  "bg-primary",
  "bg-success",
  "bg-muted-foreground",
];

function SkeletonRow() {
  return (
    <div className="space-y-2">
      <div className="flex justify-between">
        <div className="h-3.5 w-32 rounded bg-muted animate-pulse" />
        <div className="h-3.5 w-12 rounded bg-muted animate-pulse" />
      </div>
      <div className="h-2 rounded-full bg-muted animate-pulse" />
    </div>
  );
}

export function DeniedReasonsCard({ days = 7 }: { days?: number }) {
  const { data, isLoading, isError } = useQuery({
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-danger/10">
              <ShieldX className="size-3.5 text-danger" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                최근 {days}일 거절 사유
              </h2>
              <p className="text-xs text-muted-foreground">출입 거절 분포</p>
            </div>
          </div>
          {total > 0 && (
            <span className="rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-bold text-danger">
              총 {total}건
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {isLoading && (
          <div className="space-y-4">
            {[...Array(4)].map((_, i) => <SkeletonRow key={i} />)}
          </div>
        )}

        {isError && (
          <div className="py-6 text-center">
            <p className="text-sm text-danger">데이터를 불러오지 못했습니다</p>
          </div>
        )}

        {!isLoading && !isError && (data?.length ?? 0) === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <CheckCircle2 className="size-8 text-success/60" />
            <p className="text-sm font-medium text-foreground">거절 기록 없음</p>
            <p className="text-xs text-muted-foreground">최근 {days}일간 출입 거절이 없습니다</p>
          </div>
        )}

        {(data?.length ?? 0) > 0 && (
          <div className="space-y-4">
            {(data ?? []).map((r, idx) => {
              const pct = Math.round((r.count / max) * 100);
              const totalPct = total === 0 ? 0 : (r.count / total) * 100;
              const label =
                DENIED_REASON_LABELS[r.denied_reason as DeniedReason] ??
                r.denied_reason;
              const barColor = REASON_COLORS[idx % REASON_COLORS.length];

              return (
                <div key={r.denied_reason} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={cn("size-2 shrink-0 rounded-full", barColor)} />
                      <span className="truncate text-sm text-foreground">{label}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground tabular">
                        {totalPct.toFixed(0)}%
                      </span>
                      <span className="text-xs font-semibold text-foreground tabular w-8 text-right">
                        {r.count}건
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all duration-500", barColor)}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

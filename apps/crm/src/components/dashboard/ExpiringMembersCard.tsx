import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Clock, ChevronRight, CheckCircle2, RefreshCw } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { listExpiringMemberships } from "@/services/dashboardWidgets";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";

const DAY_TABS = [7, 14, 30] as const;
type DayTab = typeof DAY_TABS[number];

function DaysChip({ days }: { days: number }) {
  if (days <= 2) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-semibold text-danger">
        <span className="size-1.5 rounded-full bg-danger animate-pulse" />
        D-{days}
      </span>
    );
  }
  if (days <= 7) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-semibold text-warning">
        D-{days}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
      D-{days}
    </span>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-3 px-5">
      <div className="size-8 rounded-full bg-muted animate-pulse" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3.5 w-24 rounded bg-muted animate-pulse" />
        <div className="h-3 w-36 rounded bg-muted animate-pulse" />
      </div>
      <div className="h-5 w-12 rounded-full bg-muted animate-pulse" />
    </div>
  );
}

export function ExpiringMembersCard({ days: initialDays = 7 }: { days?: DayTab }) {
  const [days, setDays] = useState<DayTab>(initialDays);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard-expiring", days],
    queryFn: () => listExpiringMemberships(days, 30),
    staleTime: 60_000,
  });

  const count = data?.length ?? 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-warning/10">
              <Clock className="size-3.5 text-warning" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">만료 예정 회원</h2>
              <p className="text-xs text-muted-foreground">이용권 기준</p>
            </div>
          </div>
          {count > 0 && (
            <span className="rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-bold text-warning">
              {count}명
            </span>
          )}
        </div>

        {/* 일수 탭 */}
        <div className="mt-3 flex gap-1.5">
          {DAY_TABS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold transition-all",
                days === d
                  ? "border-warning bg-warning/10 text-warning"
                  : "border-border bg-card text-muted-foreground hover:border-warning/40"
              )}
            >
              {d}일 이내
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading && (
          <div className="divide-y divide-border">
            {[...Array(4)].map((_, i) => <SkeletonRow key={i} />)}
          </div>
        )}

        {isError && (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-danger">데이터를 불러오지 못했습니다</p>
          </div>
        )}

        {!isLoading && !isError && count === 0 && (
          <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
            <CheckCircle2 className="size-8 text-success/60" />
            <p className="text-sm font-medium text-foreground">{days}일 내 만료 예정 없음</p>
            <p className="text-xs text-muted-foreground">모든 이용권이 정상입니다</p>
          </div>
        )}

        {count > 0 && (
          <ul className="divide-y divide-border">
            {(data ?? []).map((m) => {
              const initials = m.member_name
                .split(" ")
                .map((n: string) => n[0])
                .join("")
                .slice(0, 2)
                .toUpperCase();

              return (
                <li key={m.id} className="flex items-center gap-2 px-4 py-3 hover:bg-muted/40 transition-colors group">
                  {/* 아바타 */}
                  <Link
                    to={`/members/${m.member_id}`}
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary"
                  >
                    {initials}
                  </Link>

                  {/* 이름 / 플랜 */}
                  <Link to={`/members/${m.member_id}`} className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {m.member_name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {m.plan_name} · 만료 {formatDate(m.end_date)}
                    </p>
                  </Link>

                  {/* 남은 일수 */}
                  <DaysChip days={m.days_remaining} />

                  {/* 연장 버튼 (hover) */}
                  <Link to={`/members/${m.member_id}`} title="회원 상세에서 연장">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 h-7 px-2 text-xs border-primary/30 text-primary hover:bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <RefreshCw className="size-3" /> 연장
                    </Button>
                  </Link>

                  <Link to={`/members/${m.member_id}`}>
                    <ChevronRight className="size-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Clock, ChevronRight, CheckCircle2 } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { listExpiringMemberships } from "@/services/dashboardWidgets";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";

function DaysChip({ days }: { days: number }) {
  if (days <= 2) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-semibold text-danger">
        <span className="size-1.5 rounded-full bg-danger animate-pulse" />
        {days}일
      </span>
    );
  }
  if (days <= 5) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-semibold text-warning">
        {days}일
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
      {days}일
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

export function ExpiringMembersCard({ days = 7 }: { days?: number }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard-expiring", days],
    queryFn: () => listExpiringMemberships(days, 20),
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
              <h2 className="text-sm font-semibold text-foreground">
                {days}일 이내 만료 예정
              </h2>
              <p className="text-xs text-muted-foreground">이용권 기준</p>
            </div>
          </div>
          {count > 0 && (
            <span className="rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-bold text-warning">
              {count}건
            </span>
          )}
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
            <p className="text-sm font-medium text-foreground">만료 예정 이용권 없음</p>
            <p className="text-xs text-muted-foreground">모든 회원 이용권이 정상입니다</p>
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
                <li key={m.id}>
                  <Link
                    to={`/members/${m.member_id}`}
                    className={cn(
                      "flex items-center gap-3 px-5 py-3 transition-colors",
                      "hover:bg-muted/60 group"
                    )}
                  >
                    {/* 아바타 */}
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {initials}
                    </div>

                    {/* 이름 / 플랜 */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {m.member_name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.plan_name} · 만료 {formatDate(m.end_date)}
                      </p>
                    </div>

                    {/* 남은 일수 + 화살표 */}
                    <div className="flex items-center gap-1.5">
                      <DaysChip days={m.days_remaining} />
                      <ChevronRight className="size-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                    </div>
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

import { Link } from "react-router-dom";
import { errorMessage } from "@/lib/errors";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { listExpiringMemberships } from "@/services/dashboardWidgets";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";

export function ExpiringMembersCard({ days = 7 }: { days?: number }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard-expiring", days],
    queryFn: () => listExpiringMemberships(days, 20),
    staleTime: 60_000,
  });

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold opacity-80">
          {days}일 이내 만료 예정 이용권
        </h2>
        <p className="text-xs opacity-60 mt-0.5">최대 20건 — 행 클릭 시 회원 상세</p>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading && <p className="px-4 py-6 text-sm opacity-60">로딩 중…</p>}
        {isError && (
          <p className="px-4 py-6 text-sm text-red-600">
            오류: {errorMessage(error)}
          </p>
        )}
        {!isLoading && !isError && (data?.length ?? 0) === 0 && (
          <p className="px-4 py-6 text-sm opacity-60">만료 예정 이용권이 없습니다.</p>
        )}
        {(data?.length ?? 0) > 0 && (
          <ul className="divide-y divide-foreground/5">
            {(data ?? []).map((m) => (
              <li key={m.id} className="px-4 py-2.5">
                <Link
                  to={`/members/${m.member_id}`}
                  className="flex items-center justify-between gap-3 hover:bg-foreground/5 -mx-4 px-4 py-1 rounded"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{m.member_name}</div>
                    <div className="text-xs opacity-70 truncate">
                      {m.plan_name} · {formatDate(m.end_date)}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                      m.days_remaining <= 2
                        ? "bg-red-100 text-red-700"
                        : m.days_remaining <= 5
                          ? "bg-yellow-100 text-yellow-800"
                          : "bg-blue-100 text-blue-700"
                    )}
                  >
                    {m.days_remaining}일 남음
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

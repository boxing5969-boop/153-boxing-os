import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "@/lib/errors";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { roleLabel } from "@/lib/roleLabels";
import { getDashboardStats } from "@/services/dashboardStats";
import { ExpiringMembersCard } from "@/components/dashboard/ExpiringMembersCard";
import { DeniedReasonsCard } from "@/components/dashboard/DeniedReasonsCard";

interface WidgetSpec {
  label: string;
  value: number | string;
  hint: string;
  tone?: "default" | "warning" | "danger";
}

export default function DashboardPage() {
  const { profile } = useAuth();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: getDashboardStats,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const widgets: WidgetSpec[] = [
    {
      label: "오늘 출입 성공",
      value: isLoading ? "…" : (data?.todaySuccessCount ?? 0),
      hint: "00:00 부터 누적",
    },
    {
      label: "오늘 출입 거절",
      value: isLoading ? "…" : (data?.todayDeniedCount ?? 0),
      hint: "거절 사유는 출입로그에서 확인",
      tone: (data?.todayDeniedCount ?? 0) > 0 ? "warning" : "default",
    },
    {
      label: "이번주 만료 예정",
      value: isLoading ? "…" : (data?.expiringMembershipsCount ?? 0),
      hint: "다음 7일 내 active 이용권",
    },
    {
      label: "단말기 동기화 실패",
      value: isLoading ? "…" : (data?.failedSyncJobsCount ?? 0),
      hint: "Phase 6 자동 재시도 후 잔여",
      tone: (data?.failedSyncJobsCount ?? 0) > 0 ? "danger" : "default",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">대시보드</h1>
        <p className="mt-1 text-sm opacity-70">
          {profile?.name} ({roleLabel(profile?.role)}) — 오늘 운영 현황
        </p>
      </div>

      {isError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          통계 조회 실패: {errorMessage(error)}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {widgets.map((w) => (
          <Card key={w.label} className="p-4">
            <div className="text-sm opacity-70">{w.label}</div>
            <div
              className={`mt-2 text-3xl font-bold ${
                w.tone === "warning"
                  ? "text-yellow-600"
                  : w.tone === "danger"
                    ? "text-red-600"
                    : ""
              }`}
            >
              {w.value}
            </div>
            <div className="mt-1 text-xs opacity-50">{w.hint}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ExpiringMembersCard days={7} />
        <DeniedReasonsCard days={7} />
      </div>
    </div>
  );
}

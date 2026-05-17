import { useQuery } from "@tanstack/react-query";
import {
  LogIn,
  LogOut,
  Clock,
  AlertTriangle,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { roleLabel } from "@/lib/roleLabels";
import { getDashboardStats } from "@/services/dashboardStats";
import { ExpiringMembersCard } from "@/components/dashboard/ExpiringMembersCard";
import { DeniedReasonsCard } from "@/components/dashboard/DeniedReasonsCard";
import { RevenueSnapshotCard } from "@/components/dashboard/RevenueSnapshotCard";
import { cn } from "@/lib/cn";

interface KpiSpec {
  label: string;
  value: number | string;
  hint: string;
  icon: LucideIcon;
  tone: "default" | "success" | "warning" | "danger";
}

function KpiCard({ spec, loading }: { spec: KpiSpec; loading: boolean }) {
  const Icon = spec.icon;

  const toneStyles = {
    default: {
      icon: "bg-primary/10 text-primary",
      value: "text-foreground",
      dot: "",
    },
    success: {
      icon: "bg-success/10 text-success",
      value: "text-success",
      dot: "bg-success",
    },
    warning: {
      icon: "bg-warning/10 text-warning",
      value: "text-warning",
      dot: "bg-warning",
    },
    danger: {
      icon: "bg-danger/10 text-danger",
      value: "text-danger",
      dot: "bg-danger",
    },
  }[spec.tone];

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-card flex flex-col gap-4">
      {/* 상단: 라벨 + 아이콘 */}
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-muted-foreground">{spec.label}</p>
        <div className={cn("flex size-9 items-center justify-center rounded-lg", toneStyles.icon)}>
          <Icon className="size-4" />
        </div>
      </div>

      {/* 숫자 */}
      <div>
        {loading ? (
          <div className="h-9 w-16 animate-pulse rounded-md bg-muted" />
        ) : (
          <p className={cn("text-3xl font-black tabular", toneStyles.value)}>
            {spec.value}
          </p>
        )}
        <p className="mt-1.5 text-xs text-muted-foreground">{spec.hint}</p>
      </div>

      {/* 상태 인디케이터 */}
      {spec.tone !== "default" && !loading && Number(spec.value) > 0 && (
        <div className="flex items-center gap-1.5">
          <div className={cn("size-1.5 rounded-full animate-pulse", toneStyles.dot)} />
          <span className="text-xs text-muted-foreground">
            {spec.tone === "danger" ? "즉시 확인 필요" : "확인 필요"}
          </span>
        </div>
      )}
    </div>
  );
}

function WelcomeBanner({ name, role }: { name?: string; role?: string }) {
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "좋은 아침이에요" : hour < 18 ? "안녕하세요" : "수고하셨어요";

  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-black text-foreground">
          {greeting}, {name ?? "관리자"}님 👋
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {role} · 오늘의 운영 현황을 확인하세요
        </p>
      </div>
      <div className="hidden sm:flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 shadow-card">
        <TrendingUp className="size-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">실시간 현황</span>
        <div className="size-2 rounded-full bg-success animate-pulse" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { profile } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: getDashboardStats,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const kpis: KpiSpec[] = [
    {
      label: "오늘 출입 성공",
      value: isLoading ? "…" : (data?.todaySuccessCount ?? 0),
      hint: "00:00부터 누적",
      icon: LogIn,
      tone: "default",
    },
    {
      label: "오늘 출입 거절",
      value: isLoading ? "…" : (data?.todayDeniedCount ?? 0),
      hint: "거절 사유는 출입로그에서 확인",
      icon: LogOut,
      tone: (data?.todayDeniedCount ?? 0) > 0 ? "warning" : "default",
    },
    {
      label: "이번주 만료 예정",
      value: isLoading ? "…" : (data?.expiringMembershipsCount ?? 0),
      hint: "다음 7일 내 active 이용권",
      icon: Clock,
      tone: (data?.expiringMembershipsCount ?? 0) > 0 ? "warning" : "default",
    },
    {
      label: "단말기 동기화 실패",
      value: isLoading ? "…" : (data?.failedSyncJobsCount ?? 0),
      hint: "자동 재시도 후 잔여",
      icon: AlertTriangle,
      tone: (data?.failedSyncJobsCount ?? 0) > 0 ? "danger" : "default",
    },
  ];

  return (
    <div className="space-y-7">
      {/* 웰컴 배너 */}
      <WelcomeBanner
        name={profile?.name}
        role={roleLabel(profile?.role)}
      />

      {/* KPI 카드 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((spec) => (
          <KpiCard key={spec.label} spec={spec} loading={isLoading} />
        ))}
      </div>

      {/* 하단 카드 3열 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ExpiringMembersCard days={7} />
        <DeniedReasonsCard days={7} />
        <RevenueSnapshotCard />
      </div>
    </div>
  );
}

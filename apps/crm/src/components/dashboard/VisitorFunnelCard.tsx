/**
 * 상담·체험 퍼널 요약 카드
 * - visitor_requests 단독 쿼리 (DB 변경 없음)
 * - VisitorsListPage는 건드리지 않음 — 숫자 + 바로가기만 표시
 */
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  UserPlus,
  Clock,
  CalendarCheck,
  CheckCircle2,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { getVisitorFunnelStats } from "@/services/dashboardWidgets";
import { cn } from "@/lib/cn";

interface FunnelStat {
  label: string;
  sub: string;
  value: number;
  icon: LucideIcon;
  tone: "default" | "warning" | "primary" | "success";
}

function StatItem({
  stat,
  loading,
}: {
  stat: FunnelStat;
  loading: boolean;
}) {
  const Icon = stat.icon;

  const toneMap = {
    default:  { icon: "bg-muted text-muted-foreground",       value: "text-foreground",  border: "border-border" },
    warning:  { icon: "bg-warning/10 text-warning",            value: "text-warning",     border: "border-warning/20" },
    primary:  { icon: "bg-primary/10 text-primary",            value: "text-primary",     border: "border-primary/20" },
    success:  { icon: "bg-success/10 text-success",            value: "text-success",     border: "border-success/20" },
  }[stat.tone];

  return (
    <div className={cn(
      "flex flex-col items-center gap-2 rounded-xl border px-4 py-4 text-center",
      toneMap.border
    )}>
      <div className={cn("flex size-8 items-center justify-center rounded-lg", toneMap.icon)}>
        <Icon className="size-4" />
      </div>

      {loading ? (
        <div className="h-7 w-10 animate-pulse rounded-md bg-muted" />
      ) : (
        <p className={cn("text-2xl font-black tabular leading-none", toneMap.value)}>
          {stat.value}
        </p>
      )}

      <div>
        <p className="text-xs font-semibold text-foreground leading-tight">{stat.label}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">{stat.sub}</p>
      </div>
    </div>
  );
}

export function VisitorFunnelCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["visitor-funnel"],
    queryFn: getVisitorFunnelStats,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const stats: FunnelStat[] = [
    {
      label: "오늘 신규 신청",
      sub: "오늘 접수된 방문 요청",
      value: data?.todayNewCount ?? 0,
      icon: UserPlus,
      tone: (data?.todayNewCount ?? 0) > 0 ? "primary" : "default",
    },
    {
      label: "승인 대기",
      sub: "처리 필요",
      value: data?.pendingCount ?? 0,
      icon: Clock,
      tone: (data?.pendingCount ?? 0) > 0 ? "warning" : "default",
    },
    {
      label: "오늘 예정",
      sub: "오늘 방문 확정",
      value: data?.todayScheduledCount ?? 0,
      icon: CalendarCheck,
      tone: (data?.todayScheduledCount ?? 0) > 0 ? "primary" : "default",
    },
    {
      label: "이번주 완료",
      sub: "월요일부터 누적",
      value: data?.weekCompletedCount ?? 0,
      icon: CheckCircle2,
      tone: (data?.weekCompletedCount ?? 0) > 0 ? "success" : "default",
    },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card shadow-card">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary/10">
            <CalendarCheck className="size-3.5 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">상담·체험 퍼널</h2>
            <p className="text-xs text-muted-foreground">방문 신청 현황 요약</p>
          </div>
        </div>
        <Link
          to="/visitors"
          className="flex items-center gap-1 text-xs text-primary hover:underline font-medium"
        >
          전체 관리 <ArrowRight className="size-3" />
        </Link>
      </div>

      {/* 지표 그리드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4">
        {stats.map((stat) => (
          <StatItem key={stat.label} stat={stat} loading={isLoading} />
        ))}
      </div>

      {/* 안내 푸터 */}
      <div className="border-t border-border px-5 py-2.5 bg-muted/20">
        <p className="text-[11px] text-muted-foreground">
          💡 체험 후 미등록 추적은 추후 지원 예정입니다.
          상세 관리는 <Link to="/visitors" className="text-primary underline underline-offset-2">방문자 페이지</Link>에서 하세요.
        </p>
      </div>
    </div>
  );
}

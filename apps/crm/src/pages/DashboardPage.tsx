import { useQuery } from "@tanstack/react-query";
import { Navigate, Link } from "react-router-dom";
import {
  LogIn,
  Clock,
  BanknoteIcon,
  UserPlus,
  UserCheck,
  CreditCard,
  SendHorizontal,
  TrendingUp,
  ClipboardList,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { roleLabel } from "@/lib/roleLabels";
import { getDashboardStats } from "@/services/dashboardStats";
import { getAutoStats } from "@/services/reportAutoStats";
import { ExpiringMembersCard } from "@/components/dashboard/ExpiringMembersCard";
import { DeniedReasonsCard } from "@/components/dashboard/DeniedReasonsCard";
import { RevenueSnapshotCard } from "@/components/dashboard/RevenueSnapshotCard";
import { AtRiskMembersCard } from "@/components/dashboard/AtRiskMembersCard";
import { TodayActionStrip } from "@/components/dashboard/TodayActionStrip";
import { ContactActionBoard } from "@/components/dashboard/ContactActionBoard";
import { VisitorFunnelCard } from "@/components/dashboard/VisitorFunnelCard";
import { LossPreventionCard } from "@/components/dashboard/LossPreventionCard";
import { cn } from "@/lib/cn";

interface KpiSpec {
  label: string;
  value: number | string;
  hint: string;
  icon: LucideIcon;
  tone: "default" | "success" | "warning" | "danger";
  to?: string;
}

function KpiCard({ spec, loading }: { spec: KpiSpec; loading: boolean }) {
  const Icon = spec.icon;

  const toneStyles = {
    default: { icon: "bg-primary/10 text-primary", value: "text-foreground", dot: "" },
    success: { icon: "bg-success/10 text-success", value: "text-success", dot: "bg-success" },
    warning: { icon: "bg-warning/10 text-warning", value: "text-warning", dot: "bg-warning" },
    danger: { icon: "bg-danger/10 text-danger", value: "text-danger", dot: "bg-danger" },
  }[spec.tone];

  const body = (
    <div className="flex h-full flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-card transition hover:border-primary/30">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-muted-foreground">{spec.label}</p>
        <div className={cn("flex size-9 items-center justify-center rounded-xl", toneStyles.icon)}>
          <Icon className="size-4" />
        </div>
      </div>
      <div>
        {loading ? (
          <div className="h-9 w-16 animate-pulse rounded-lg bg-muted" />
        ) : (
          <p className={cn("text-3xl font-black tabular", toneStyles.value)}>{spec.value}</p>
        )}
        <p className="mt-1.5 text-xs text-muted-foreground">{spec.hint}</p>
      </div>
      {spec.tone !== "default" && !loading && Number(spec.value) > 0 && (
        <span
          className={cn(
            "inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
            toneStyles.icon
          )}
        >
          <span className={cn("size-1.5 rounded-full", toneStyles.dot)} />
          {spec.tone === "danger" ? "즉시 확인 필요" : "확인 필요"}
        </span>
      )}
    </div>
  );

  // 숫자 카드는 장식이 아니라 실제 목록으로 이동한다 (킷 홈 원칙)
  return spec.to ? (
    <Link to={spec.to} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-2xl">
      {body}
    </Link>
  ) : (
    body
  );
}

// ── 빠른 실행 (킷: 회원 등록/체험 등록/이용권·결제/문자/리포트) ──
interface QuickAction {
  label: string;
  to: string;
  icon: LucideIcon;
}
const QUICK_ACTIONS: QuickAction[] = [
  { label: "회원 등록", to: "/members/new", icon: UserPlus },
  { label: "체험 등록", to: "/visitors", icon: UserCheck },
  { label: "이용권 연장", to: "/memberships", icon: CreditCard },
  { label: "결제 등록", to: "/memberships", icon: BanknoteIcon },
  { label: "문자 보내기", to: "/admin/bulk-notify", icon: SendHorizontal },
  { label: "리포트 작성", to: "/reports/daily", icon: ClipboardList },
];

function QuickActions() {
  return (
    <section aria-label="빠른 실행">
      <h2 className="mb-2 text-sm font-bold text-foreground">빠른 실행</h2>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {QUICK_ACTIONS.map((a) => {
          const Icon = a.icon;
          return (
            <Link
              key={a.label}
              to={a.to}
              className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card px-2 py-3 text-center shadow-card transition hover:border-primary/40 hover:bg-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-4" />
              </span>
              <span className="text-xs font-semibold text-foreground leading-tight">{a.label}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function WelcomeBanner({ name, role }: { name?: string; role?: string }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "좋은 아침이에요" : hour < 18 ? "안녕하세요" : "수고하셨어요";

  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-black text-foreground">
          {greeting}, {name ?? "관리자"}님 👋
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {role} · 오늘 처리할 일을 먼저 확인하세요
        </p>
      </div>
      <div className="hidden sm:flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 shadow-card">
        <TrendingUp className="size-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">실시간 현황</span>
        <span className="size-2 rounded-full bg-success" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { profile } = useAuth();
  const isCoach = profile?.role === "coach";

  const { data, isLoading: opsLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: getDashboardStats,
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: !isCoach,
  });

  // 핵심 4카드 — 브로제이 명부 기준 통합 집계 (일일 리포트·출입 현황과 같은 숫자)
  const { data: auto, isLoading } = useQuery({
    queryKey: ["auto-stats", profile?.branch_id ?? "all"],
    queryFn: () => getAutoStats({ branchId: profile?.branch_id ?? undefined }),
    staleTime: 30_000,
    refetchInterval: 60_000,
    enabled: !isCoach,
  });

  // 코치 역할은 전용 업무보드로 리다이렉트
  if (isCoach) return <Navigate to="/coach" replace />;

  // ── 핵심 현황: 최대 4개 (킷 홈 원칙) ──
  // 각 카드는 해당 필터 목록으로 이동. 데이터 없으면 0이 아니라 출처/지연 표기.
  const kpis: KpiSpec[] = [
    {
      label: "오늘 출입",
      value: isLoading ? "…" : (auto?.accessSuccess ?? 0),
      hint: "00:00부터 출입 성공 누적",
      icon: LogIn,
      tone: "default",
      to: "/access-logs",
    },
    {
      label: "오늘 신규 등록",
      value: isLoading ? "…" : (auto?.newMembers ?? 0),
      hint: "브로제이 가입일 기준",
      icon: UserPlus,
      tone: (auto?.newMembers ?? 0) > 0 ? "success" : "default",
      to: "/members",
    },
    {
      label: "미납 회원",
      value: isLoading ? "…" : (auto?.unpaid ?? 0),
      hint: "결제 확인이 필요한 회원",
      icon: BanknoteIcon,
      tone: (auto?.unpaid ?? 0) > 0 ? "danger" : "default",
      to: "/members?status=unpaid",
    },
    {
      label: "이번주 만료 예정",
      value: isLoading ? "…" : (auto?.expiringSoon ?? 0),
      hint: "브로제이 만료일 기준 · 7일 내",
      icon: Clock,
      tone: (auto?.expiringSoon ?? 0) > 0 ? "warning" : "default",
      to: "/members",
    },
  ];

  return (
    <div className="space-y-6">
      {/* 인사 */}
      <WelcomeBanner name={profile?.name} role={roleLabel(profile?.role)} />

      {/* 1. 오늘의 회원 케어 — 가장 먼저 (킷 홈 우선순위) */}
      <ContactActionBoard />

      {/* 2. 핵심 현황 — 최대 4개 */}
      <section aria-label="오늘 매장 현황">
        <h2 className="mb-2 text-sm font-bold text-foreground">오늘 매장 현황</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 sm:gap-4">
          {kpis.map((spec) => (
            <KpiCard key={spec.label} spec={spec} loading={isLoading} />
          ))}
        </div>
      </section>

      {/* 3. 빠른 실행 */}
      <QuickActions />

      {/* 4. 일일 리포트 상태 — 핵심 진입 */}
      <Link
        to="/reports/daily"
        className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-5 py-4 transition hover:bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <ClipboardList className="size-5" />
          </div>
          <div>
            <p className="text-sm font-bold text-foreground">오늘 경영 리포트</p>
            <p className="text-xs text-muted-foreground">
              매출·출입·회원 현황이 자동으로 채워집니다 · 매일 작성
            </p>
          </div>
        </div>
        <ChevronRight className="size-5 text-muted-foreground" />
      </Link>

      {/* 5. 최근 출입 문제 */}
      <DeniedReasonsCard days={7} />

      {/* 보조 현황 — 처리할 일/퍼널/손실방지 */}
      {!opsLoading && (
        <TodayActionStrip
          pendingVisitorCount={data?.pendingVisitorCount ?? 0}
          pendingScheduledMessagesCount={data?.pendingScheduledMessagesCount ?? 0}
          dueFollowupsCount={data?.dueFollowupsCount ?? 0}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <ExpiringMembersCard days={7} />
        <AtRiskMembersCard />
        <RevenueSnapshotCard />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <VisitorFunnelCard />
        <LossPreventionCard />
      </div>
    </div>
  );
}

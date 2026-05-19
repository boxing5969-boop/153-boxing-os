/**
 * 본사 통합 대시보드
 * super_admin / hq_admin 전용 — 전 지점 현황 한눈에
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  Users,
  LogIn,
  LogOut,
  Clock,
  BanknoteIcon,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { getHqStats, type BranchStat } from "@/services/hqStats";
import { cn } from "@/lib/cn";

// ── KPI 집계 ────────────────────────────────────────────────
function sum(stats: BranchStat[], key: keyof BranchStat): number {
  return stats.reduce((acc, s) => acc + Number(s[key]), 0);
}

interface KpiCardProps {
  label: string;
  value: number | string;
  hint: string;
  icon: React.ElementType;
  tone: "default" | "success" | "warning" | "danger";
}

function KpiCard({ label, value, hint, icon: Icon, tone }: KpiCardProps) {
  const tones = {
    default: { icon: "bg-primary/10 text-primary",  value: "text-foreground" },
    success: { icon: "bg-success/10 text-success",  value: "text-success" },
    warning: { icon: "bg-warning/10 text-warning",  value: "text-warning" },
    danger:  { icon: "bg-danger/10 text-danger",    value: "text-danger" },
  }[tone];

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-card flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <div className={cn("flex size-9 items-center justify-center rounded-lg", tones.icon)}>
          <Icon className="size-4" />
        </div>
      </div>
      <p className={cn("text-3xl font-black tabular", tones.value)}>{value}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

// ── 지점 상태 색 ─────────────────────────────────────────────
function rowTone(s: BranchStat): string {
  if (s.failed_sync > 0)    return "border-l-4 border-l-danger";
  if (s.unpaid_members > 0) return "border-l-4 border-l-warning";
  return "";
}

function StatusDot({ count, tone }: { count: number; tone: "danger" | "warning" | "success" }) {
  if (count === 0) return <span className="text-muted-foreground tabular">0</span>;
  const colors = {
    danger:  "text-danger  font-bold",
    warning: "text-warning font-bold",
    success: "text-success font-medium",
  }[tone];
  return <span className={cn("tabular", colors)}>{count}</span>;
}

export default function HqDashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["hq-stats"],
    queryFn: getHqStats,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const stats = data ?? [];
  const totalBranches    = stats.length;
  const totalActive      = sum(stats, "active_members");
  const totalAccess      = sum(stats, "today_access");
  const totalDenied      = sum(stats, "today_denied");
  const totalExpiring    = sum(stats, "expiring_7d");
  const totalUnpaid      = sum(stats, "unpaid_members");
  const totalFailedSync  = sum(stats, "failed_sync");

  // 차트 데이터: 활성 회원 수 기준 정렬
  const chartData = [...stats]
    .sort((a, b) => b.active_members - a.active_members)
    .map((s) => ({
      name: s.branch_name.length > 6 ? s.branch_name.slice(0, 6) + "…" : s.branch_name,
      활성: s.active_members,
      출입: s.today_access,
      미납: s.unpaid_members,
    }));

  return (
    <div className="space-y-6 max-w-6xl">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="size-4" /> 대시보드
          </Link>
          <h1 className="text-2xl font-black text-foreground flex items-center gap-2">
            <Building2 className="size-6 text-primary" />
            본사 통합 현황
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            전 지점 실시간 운영 지표 · 1분 자동 갱신
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 shadow-card">
          <TrendingUp className="size-4 text-primary" />
          <span className="text-sm font-semibold">{totalBranches}개 지점</span>
          <div className="size-2 rounded-full bg-success animate-pulse" />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          데이터를 불러오지 못했습니다 — {error instanceof Error ? error.message : "오류"}
        </div>
      )}

      {/* 전사 KPI */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="활성 회원"      value={isLoading ? "…" : totalActive}      hint="전 지점 합계"        icon={Users}         tone="default" />
        <KpiCard label="오늘 출입"      value={isLoading ? "…" : totalAccess}      hint="성공 기준"           icon={LogIn}         tone="success" />
        <KpiCard label="오늘 거절"      value={isLoading ? "…" : totalDenied}      hint="출입 거절 건수"      icon={LogOut}        tone={totalDenied > 0 ? "warning" : "default"} />
        <KpiCard label="이번주 만료"    value={isLoading ? "…" : totalExpiring}    hint="7일 내 만료 예정"    icon={Clock}         tone={totalExpiring > 5 ? "warning" : "default"} />
        <KpiCard label="미납 회원"      value={isLoading ? "…" : totalUnpaid}      hint="즉시 연락 필요"      icon={BanknoteIcon}  tone={totalUnpaid > 0 ? "danger" : "default"} />
        <KpiCard label="동기화 실패"    value={isLoading ? "…" : totalFailedSync}  hint="단말기 오류 지점"    icon={AlertTriangle} tone={totalFailedSync > 0 ? "danger" : "default"} />
      </div>

      {/* 차트 + 테이블 2열 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 활성 회원 바 차트 */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-card">
          <h2 className="text-sm font-semibold text-foreground mb-4">지점별 활성 회원</h2>
          {isLoading ? (
            <div className="h-48 animate-pulse rounded-lg bg-muted" />
          ) : chartData.length === 0 ? (
            <p className="h-48 flex items-center justify-center text-sm text-muted-foreground">데이터 없음</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  cursor={{ fill: "var(--muted)" }}
                />
                <Bar dataKey="활성" radius={[4, 4, 0, 0]}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={`hsl(${220 + i * 18}, 70%, 55%)`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 오늘 출입 바 차트 */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-card">
          <h2 className="text-sm font-semibold text-foreground mb-4">오늘 지점별 출입</h2>
          {isLoading ? (
            <div className="h-48 animate-pulse rounded-lg bg-muted" />
          ) : chartData.length === 0 ? (
            <p className="h-48 flex items-center justify-center text-sm text-muted-foreground">데이터 없음</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  cursor={{ fill: "var(--muted)" }}
                />
                <Bar dataKey="출입" fill="var(--success)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="미납" fill="var(--danger)"  radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* 지점별 상세 테이블 */}
      <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">지점별 상세 현황</h2>
        </div>
        {isLoading ? (
          <div className="divide-y divide-border">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse mx-5 my-2 rounded-lg bg-muted" />
            ))}
          </div>
        ) : stats.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">지점 데이터가 없습니다</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground">
                  <th className="text-left px-5 py-3 font-medium">지점</th>
                  <th className="text-right px-4 py-3 font-medium">활성 회원</th>
                  <th className="text-right px-4 py-3 font-medium">오늘 출입</th>
                  <th className="text-right px-4 py-3 font-medium">오늘 거절</th>
                  <th className="text-right px-4 py-3 font-medium">이번주 만료</th>
                  <th className="text-right px-4 py-3 font-medium">미납</th>
                  <th className="text-right px-5 py-3 font-medium">동기화 실패</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {stats.map((s) => (
                  <tr
                    key={s.branch_id}
                    className={cn("hover:bg-muted/20 transition-colors", rowTone(s))}
                  >
                    <td className="px-5 py-3">
                      <Link
                        to={`/branches/${s.branch_id}`}
                        className="font-medium text-foreground hover:text-primary transition-colors"
                      >
                        {s.branch_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right tabular">{s.active_members}</td>
                    <td className="px-4 py-3 text-right">
                      <StatusDot count={s.today_access} tone="success" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <StatusDot count={s.today_denied} tone="warning" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <StatusDot count={s.expiring_7d} tone="warning" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <StatusDot count={s.unpaid_members} tone="danger" />
                    </td>
                    <td className="px-5 py-3 text-right">
                      <StatusDot count={s.failed_sync} tone="danger" />
                    </td>
                  </tr>
                ))}
              </tbody>

              {/* 합계 row */}
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/20 text-xs font-bold">
                  <td className="px-5 py-3 text-muted-foreground">전체 합계</td>
                  <td className="px-4 py-3 text-right tabular">{totalActive}</td>
                  <td className="px-4 py-3 text-right tabular text-success">{totalAccess}</td>
                  <td className="px-4 py-3 text-right tabular text-warning">{totalDenied}</td>
                  <td className="px-4 py-3 text-right tabular text-warning">{totalExpiring}</td>
                  <td className="px-4 py-3 text-right tabular text-danger">{totalUnpaid}</td>
                  <td className="px-5 py-3 text-right tabular text-danger">{totalFailedSync}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

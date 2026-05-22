/**
 * KPI 대시보드 — 4차
 * 권한 적응형: 본사(super_admin/hq_admin) → 본사 KPI 10종,
 *              그 외(지점관리자 등) → 지점 운영 KPI 7종.
 * 데이터는 SECURITY DEFINER RPC가 권한검증·테넌시 필터를 수행.
 * 디자인은 단순하게 — 운영에 필요한 숫자를 정확히 보여주는 데 집중.
 */
import { useQuery } from "@tanstack/react-query";
import {
  Users, UserPlus, TrendingUp, CalendarClock, CreditCard,
  CalendarX2, Building2, ClipboardList, Smile, AlertTriangle, CheckSquare,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import {
  getHqKpiDashboard, getBranchOpsDashboard,
  type HqKpiDashboard, type BranchOpsDashboard,
} from "@/services/kpi";
import { cn } from "@/lib/cn";

const HQ_ROLES = new Set(["super_admin", "hq_admin"]);

// ── 공통 통계 카드 ────────────────────────────────────────────
function StatCard({
  label, value, hint, tone = "default", icon: Icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "warning" | "danger" | "success";
  icon?: typeof Users;
}) {
  const toneCls = {
    default: "text-foreground",
    warning: "text-warning",
    danger: "text-danger",
    success: "text-success",
  }[tone];
  return (
    <Card className="rounded-2xl">
      <CardContent className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {Icon && <Icon className="size-3.5" />}
          {label}
        </div>
        <p className={cn("text-2xl font-black", toneCls)}>{value}</p>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function won(n: number): string {
  return n.toLocaleString("ko-KR") + "원";
}

// ── 본사 KPI 뷰 ───────────────────────────────────────────────
function HqView({ data }: { data: HqKpiDashboard }) {
  const totalRevenue = data.branches.reduce((s, b) => s + Number(b.revenue_month), 0);
  const totalActive = data.branches.reduce((s, b) => s + b.active_members, 0);
  const totalNew = data.branches.reduce((s, b) => s + b.new_members, 0);
  const totalUnpaid = data.branches.reduce((s, b) => s + b.unpaid_members, 0);

  return (
    <div className="space-y-5">
      {/* 조직 요약 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="이번달 총매출" value={won(totalRevenue)} icon={TrendingUp} />
        <StatCard label="전체 활성 회원" value={totalActive} icon={Users} />
        <StatCard label="이번달 신규 등록" value={totalNew} icon={UserPlus} />
        <StatCard label="재등록률" value={`${data.renewal_rate}%`} icon={CheckSquare} />
        <StatCard label="설문 만족도 평균"
          value={data.satisfaction_avg != null ? `${data.satisfaction_avg} / 5` : "—"}
          hint="최근 90일" icon={Smile} />
        <StatCard label="불만 접수 (미해결)" value={data.complaint_count}
          tone={data.complaint_count > 0 ? "danger" : "default"} icon={AlertTriangle} />
        <StatCard label="미납 회원" value={totalUnpaid}
          tone={totalUnpaid > 0 ? "warning" : "default"} icon={CreditCard} />
        <StatCard label="운영 지점 수" value={data.branches.length} icon={Building2} />
      </div>

      {/* 지점별 표 */}
      <Card className="rounded-2xl">
        <CardHeader className="text-sm font-bold text-foreground">지점별 현황</CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="text-left  px-4 py-2 font-medium whitespace-nowrap">지점</th>
                <th className="text-right px-4 py-2 font-medium whitespace-nowrap">월매출</th>
                <th className="text-right px-4 py-2 font-medium whitespace-nowrap">활성</th>
                <th className="text-right px-4 py-2 font-medium whitespace-nowrap">신규</th>
                <th className="text-right px-4 py-2 font-medium whitespace-nowrap">만료예정</th>
                <th className="text-right px-4 py-2 font-medium whitespace-nowrap">미납</th>
                <th className="text-right px-4 py-2 font-medium whitespace-nowrap">14일 미출석</th>
              </tr>
            </thead>
            <tbody>
              {data.branches.map((b) => (
                <tr key={b.branch_id} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-foreground whitespace-nowrap">{b.branch_name}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">{won(Number(b.revenue_month))}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">{b.active_members}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">{b.new_members}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <span className={cn(b.expiring_soon > 0 && "text-warning font-semibold")}>
                      {b.expiring_soon}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <span className={cn(b.unpaid_members > 0 && "text-danger font-semibold")}>
                      {b.unpaid_members}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">{b.inactive_14d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* 직원별 업무(상담) 처리율 */}
      <Card className="rounded-2xl">
        <CardHeader className="text-sm font-bold text-foreground">직원별 업무 처리율</CardHeader>
        <CardContent>
          {data.staff_processing.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">배정된 업무가 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {data.staff_processing.map((s) => (
                <div key={s.profile_id} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0 font-medium text-foreground truncate">{s.name}</span>
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${s.rate}%` }} />
                  </div>
                  <span className="w-28 text-right text-xs text-muted-foreground">
                    {s.done}/{s.total} ({s.rate}%)
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── 지점 운영 KPI 뷰 ──────────────────────────────────────────
function BranchView({ data }: { data: BranchOpsDashboard }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard label="오늘 출석 회원" value={data.today_attendance} icon={Users} />
      <StatCard label="오늘 신규 상담" value={data.new_consultations_today} icon={UserPlus} />
      <StatCard label="재등록 대상 (7일 내 만료)" value={data.renewal_targets}
        tone={data.renewal_targets > 0 ? "warning" : "default"} icon={CalendarClock} />
      <StatCard label="미납 관리 대상" value={data.unpaid_targets}
        tone={data.unpaid_targets > 0 ? "danger" : "default"} icon={CreditCard} />
      <StatCard label="처리할 업무 (오늘까지)" value={data.tasks_due}
        tone={data.tasks_due > 0 ? "warning" : "default"} icon={ClipboardList} />
      <StatCard label="만족도 낮은 회원 (미해결)" value={data.low_satisfaction}
        tone={data.low_satisfaction > 0 ? "danger" : "default"} icon={AlertTriangle} />
      <StatCard label="장기 미출석 (14일+)" value={data.long_inactive}
        tone={data.long_inactive > 0 ? "warning" : "default"} icon={CalendarX2} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════
export default function KpiDashboardPage() {
  const { profile } = useAuth();
  const isHq = !!profile && HQ_ROLES.has(profile.role);

  const hqQuery = useQuery({
    queryKey: ["hq-kpi-dashboard"],
    queryFn: getHqKpiDashboard,
    enabled: isHq,
  });
  const branchQuery = useQuery({
    queryKey: ["branch-ops-dashboard"],
    queryFn: () => getBranchOpsDashboard(),
    enabled: !!profile && !isHq,
  });

  const active = isHq ? hqQuery : branchQuery;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-black text-foreground">
          {isHq ? "본사 KPI 대시보드" : "지점 운영 대시보드"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isHq ? "전 지점 핵심 지표 — 이번달 기준" : "오늘 기준 운영 현황"}
        </p>
      </div>

      {active.isLoading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      )}

      {active.isError && (
        <div className="rounded-xl bg-danger/5 border border-danger/20 px-4 py-3 text-sm text-danger">
          KPI를 불러오지 못했습니다: {active.error instanceof Error ? active.error.message : "알 수 없는 오류"}
        </div>
      )}

      {!active.isLoading && !active.isError && (
        <>
          {isHq && hqQuery.data && (
            hqQuery.data.branches.length === 0
              ? <p className="text-sm text-muted-foreground">표시할 지점 데이터가 없습니다.</p>
              : <HqView data={hqQuery.data} />
          )}
          {!isHq && branchQuery.data && <BranchView data={branchQuery.data} />}
        </>
      )}
    </div>
  );
}

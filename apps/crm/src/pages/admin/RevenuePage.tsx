import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, Receipt, AlertCircle, RefreshCcw } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { listBranches } from "@/services/lookups";
import {
  downloadCsv,
  getOutstandingPayments,
  getRevenueDaily,
  getRevenueSummary,
} from "@/services/finance";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";

const ALLOWED = new Set([
  "super_admin",
  "hq_admin",
  "branch_owner",
  "branch_manager",
]);

const HQ_ROLES = new Set(["super_admin", "hq_admin"]);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function formatKrw(amount: number): string {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function RevenuePage() {
  const { profile } = useAuth();
  const isHq = profile ? HQ_ROLES.has(profile.role) : false;

  if (profile && !ALLOWED.has(profile.role)) {
    return <Navigate to="/" replace />;
  }

  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(todayIso());
  const [branchId, setBranchId] = useState<string>("");

  const branchesQuery = useQuery({
    queryKey: ["branches"],
    queryFn: listBranches,
    enabled: isHq,
    staleTime: 60_000,
  });

  const filters = useMemo(
    () => ({ from, to, branchId: branchId || null }),
    [from, to, branchId]
  );

  const summaryQuery = useQuery({
    queryKey: ["revenue-summary", filters],
    queryFn: () => getRevenueSummary(filters.from, filters.to, filters.branchId),
    staleTime: 30_000,
  });

  const dailyQuery = useQuery({
    queryKey: ["revenue-daily", filters],
    queryFn: () => getRevenueDaily(filters.from, filters.to, filters.branchId),
    staleTime: 30_000,
  });

  const outstandingQuery = useQuery({
    queryKey: ["revenue-outstanding", filters.branchId],
    queryFn: () => getOutstandingPayments(filters.branchId),
    staleTime: 60_000,
  });

  const summary = summaryQuery.data;
  const totalRevenue = (summary?.paid_total ?? 0) + (summary?.partial_total ?? 0);

  function handleExportDaily() {
    const rows = (dailyQuery.data ?? []).map((d) => ({
      날짜: d.day,
      매출완료: d.paid_total,
      부분결제: d.partial_total,
      미납: d.unpaid_total,
      환불: d.refunded_total,
      "결제완료 건수": d.paid_count,
      "총 건수": d.total_count,
    }));
    downloadCsv(`revenue_daily_${from}_${to}.csv`, rows);
  }

  function handleExportOutstanding() {
    const rows = (outstandingQuery.data ?? []).map((r) => ({
      회원: r.member_name,
      플랜: r.plan_name,
      시작일: r.start_date,
      종료일: r.end_date,
      결제상태: r.payment_status,
      금액: r.price ?? "",
      경과일: r.days_since_start,
    }));
    downloadCsv(`outstanding_${todayIso()}.csv`, rows);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="매출 / 회계"
        description="이용권 가격 기반 집계. NULL 가격은 합계에서 제외됨. CSV 로 회계 마감 export."
      />

      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-2">
            <Label htmlFor="rfrom">시작일</Label>
            <Input
              id="rfrom"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rto">종료일</Label>
            <Input id="rto" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rbranch">지점</Label>
            {isHq ? (
              <Select
                id="rbranch"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                disabled={branchesQuery.isLoading}
              >
                <option value="">전체</option>
                {(branchesQuery.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            ) : (
              <Input value="자기 지점 (자동)" disabled />
            )}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          label="총 매출"
          value={formatKrw(totalRevenue)}
          hint={`${summary?.paid_count ?? 0}건 결제완료 + ${summary?.partial_count ?? 0}건 부분결제`}
          tone="success"
          icon={<Receipt className="size-4" />}
        />
        <SummaryCard
          label="미납 잔액"
          value={formatKrw(summary?.unpaid_total ?? 0)}
          hint={`${summary?.unpaid_count ?? 0}건`}
          tone={(summary?.unpaid_total ?? 0) > 0 ? "warning" : "default"}
          icon={<AlertCircle className="size-4" />}
        />
        <SummaryCard
          label="환불"
          value={formatKrw(summary?.refunded_total ?? 0)}
          hint={`${summary?.refunded_count ?? 0}건`}
          tone={(summary?.refunded_total ?? 0) > 0 ? "danger" : "default"}
          icon={<RefreshCcw className="size-4" />}
        />
        <SummaryCard
          label="총 발급 건수"
          value={String(summary?.total_count ?? 0)}
          hint={`${formatDate(from)} ~ ${formatDate(to)}`}
        />
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold opacity-80">일별 분해</h2>
          <Button size="sm" variant="outline" onClick={handleExportDaily}>
            <Download className="size-4" />
            CSV
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-foreground/10 text-left text-xs uppercase opacity-60">
              <tr>
                <th className="px-4 py-2">날짜</th>
                <th className="px-4 py-2 text-right">매출</th>
                <th className="px-4 py-2 text-right">부분결제</th>
                <th className="px-4 py-2 text-right">미납</th>
                <th className="px-4 py-2 text-right">환불</th>
                <th className="px-4 py-2 text-right">건수</th>
              </tr>
            </thead>
            <tbody>
              {dailyQuery.isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center opacity-60">
                    로딩 중…
                  </td>
                </tr>
              )}
              {!dailyQuery.isLoading && (dailyQuery.data?.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center opacity-60">
                    해당 기간 매출 데이터가 없습니다.
                  </td>
                </tr>
              )}
              {(dailyQuery.data ?? []).map((d) => (
                <tr key={d.day} className="border-b border-foreground/5">
                  <td className="px-4 py-2 opacity-80">{d.day}</td>
                  <td className="px-4 py-2 text-right font-medium">
                    {formatKrw(d.paid_total)}
                  </td>
                  <td className="px-4 py-2 text-right opacity-80">
                    {d.partial_total > 0 ? formatKrw(d.partial_total) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {d.unpaid_total > 0 ? (
                      <span className="text-yellow-700">{formatKrw(d.unpaid_total)}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {d.refunded_total > 0 ? (
                      <span className="text-red-700">{formatKrw(d.refunded_total)}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2 text-right opacity-80">{d.total_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold opacity-80">미납·부분결제 회원</h2>
            <p className="text-xs opacity-60 mt-0.5">
              회계 마감 전 결제 확인 또는 정지 처리가 필요한 회원
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={handleExportOutstanding}>
            <Download className="size-4" />
            CSV
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-foreground/10 text-left text-xs uppercase opacity-60">
              <tr>
                <th className="px-4 py-2">회원</th>
                <th className="px-4 py-2">플랜</th>
                <th className="px-4 py-2">시작일</th>
                <th className="px-4 py-2">상태</th>
                <th className="px-4 py-2 text-right">금액</th>
                <th className="px-4 py-2 text-right">경과일</th>
              </tr>
            </thead>
            <tbody>
              {outstandingQuery.isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center opacity-60">
                    로딩 중…
                  </td>
                </tr>
              )}
              {!outstandingQuery.isLoading &&
                (outstandingQuery.data?.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center opacity-60">
                      미납 건이 없습니다.
                    </td>
                  </tr>
                )}
              {(outstandingQuery.data ?? []).map((r) => (
                <tr key={r.membership_id} className="border-b border-foreground/5">
                  <td className="px-4 py-2 font-medium">
                    <a
                      href={`/members/${r.member_id}`}
                      className="underline opacity-90 hover:opacity-100"
                    >
                      {r.member_name}
                    </a>
                  </td>
                  <td className="px-4 py-2 opacity-80">{r.plan_name}</td>
                  <td className="px-4 py-2 opacity-70">{formatDate(r.start_date)}</td>
                  <td className="px-4 py-2 opacity-80">{r.payment_status}</td>
                  <td className="px-4 py-2 text-right">
                    {r.price !== null ? formatKrw(r.price) : "—"}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-2 text-right",
                      r.days_since_start > 14 && "text-red-600"
                    )}
                  >
                    {r.days_since_start}일
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  tone = "default",
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "success" | "warning" | "danger";
  icon?: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-sm opacity-70">
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "mt-2 text-2xl font-bold",
          tone === "success" && "text-green-700",
          tone === "warning" && "text-yellow-600",
          tone === "danger" && "text-red-600"
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs opacity-60">{hint}</div>}
    </Card>
  );
}

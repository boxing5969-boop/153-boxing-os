import { useMemo, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { Navigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { listAlerts, type AlertRow, type AlertSeverity } from "@/services/alerts";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";

const ALLOWED = new Set([
  "super_admin",
  "hq_admin",
  "branch_owner",
  "branch_manager",
]);

const SEVERITY_STYLES: Record<string, string> = {
  info: "bg-blue-100 text-blue-800",
  warning: "bg-yellow-100 text-yellow-800",
  critical: "bg-red-100 text-red-700",
};
const SEVERITY_LABELS: Record<string, string> = {
  info: "정보",
  warning: "경고",
  critical: "심각",
};

const KIND_LABELS: Record<string, string> = {
  device_offline: "단말기 통신 두절",
  device_error: "단말기 오류 상태",
  sync_backlog: "동기화 누적",
};

type ResolvedFilter = "unresolved" | "resolved" | "all";

export default function AlertsPage() {
  const { profile } = useAuth();
  const [resolvedFilter, setResolvedFilter] = useState<ResolvedFilter>("unresolved");
  const [severityFilter, setSeverityFilter] = useState<"" | AlertSeverity>("");

  const filters = useMemo(
    () => ({
      resolved:
        resolvedFilter === "unresolved"
          ? false
          : resolvedFilter === "resolved"
            ? true
            : null,
      severity: severityFilter || null,
      limit: 200,
    }),
    [resolvedFilter, severityFilter]
  );

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["alerts", filters],
    queryFn: () => listAlerts(filters),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const counts = useMemo(() => {
    const unresolved = (data ?? []).filter((a) => !a.resolved_at).length;
    const critical = (data ?? []).filter(
      (a) => !a.resolved_at && a.severity === "critical"
    ).length;
    return { total: data?.length ?? 0, unresolved, critical };
  }, [data]);

  if (profile && !ALLOWED.has(profile.role)) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="알림"
        description="Workers cron 5분마다 자동 점검 (단말기 오프라인/오류/sync 누적). Slack webhook 미설정 시 DB 기록만 됩니다."
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard label="미해결" value={counts.unresolved} tone={counts.unresolved > 0 ? "warning" : "default"} />
        <StatCard label="심각 미해결" value={counts.critical} tone={counts.critical > 0 ? "danger" : "default"} />
        <StatCard label="조회 결과" value={counts.total} tone="default" />
      </div>

      <Card className="rounded-2xl p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select
            value={resolvedFilter}
            onChange={(e) => setResolvedFilter(e.target.value as ResolvedFilter)}
            className="h-10 rounded-xl"
          >
            <option value="unresolved">미해결만</option>
            <option value="resolved">해결됨만</option>
            <option value="all">전체</option>
          </Select>
          <Select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as AlertSeverity | "")}
            className="h-10 rounded-xl"
          >
            <option value="">심각도 전체</option>
            <option value="info">정보</option>
            <option value="warning">경고</option>
            <option value="critical">심각</option>
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden rounded-2xl">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">심각도</th>
              <th className="px-4 py-3">유형</th>
              <th className="px-4 py-3">제목</th>
              <th className="px-4 py-3">감지</th>
              <th className="px-4 py-3">알림</th>
              <th className="px-4 py-3">상태</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-5 py-16 text-center text-muted-foreground">
                  로딩 중…
                </td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={7} className="px-5 py-16 text-center text-danger">
                  오류: {errorMessage(error)}
                </td>
              </tr>
            )}
            {!isLoading && !isError && (data?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-16 text-center text-muted-foreground">
                  알림이 없습니다. 모든 단말기 정상.
                </td>
              </tr>
            )}
            {(data ?? []).map((a) => (
              <AlertRowView key={a.id} a={a} />
            ))}
          </tbody>
        </table>
        </div>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "default" | "warning" | "danger";
}) {
  return (
    <Card className="rounded-2xl p-5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Bell className="size-4" />
        {label}
      </div>
      <div
        className={cn(
          "mt-2 text-3xl font-black tabular",
          tone === "default" && "text-foreground",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-danger"
        )}
      >
        {value}
      </div>
    </Card>
  );
}

function AlertRowView({ a }: { a: AlertRow }) {
  const sev = (a.severity as string) ?? "warning";
  const detailsKv = a.details ? Object.entries(a.details) : [];
  return (
    <tr className="border-b border-border/60 align-top transition-colors hover:bg-muted/40">
      <td className="px-4 py-3">
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
            SEVERITY_STYLES[sev] ?? "bg-gray-200 text-gray-700"
          )}
        >
          {SEVERITY_LABELS[sev] ?? sev}
        </span>
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {KIND_LABELS[a.kind as string] ?? a.kind}
      </td>
      <td className="px-4 py-3">
        <div className="font-medium">{a.subject}</div>
        {detailsKv.length > 0 && (
          <div className="mt-0.5 text-xs text-muted-foreground/60">
            {detailsKv
              .filter(([, v]) => v !== null && v !== undefined)
              .map(([k, v]) => (
                <span key={k} className="mr-2">
                  {k}: {typeof v === "string" ? v : JSON.stringify(v)}
                </span>
              ))}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-muted-foreground">{formatDateTime(a.detected_at)}</td>
      <td className="px-4 py-3 text-muted-foreground">
        {a.notified_at ? formatDateTime(a.notified_at) : "—"}
      </td>
      <td className="px-4 py-3">
        {a.resolved_at ? (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">
            해결 ({formatDateTime(a.resolved_at)})
          </span>
        ) : (
          <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">
            미해결
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {a.device_id && (
          <Link
            to={`/devices/${a.device_id}`}
            className="text-xs underline text-muted-foreground hover:opacity-100"
          >
            장비 상세
          </Link>
        )}
      </td>
    </tr>
  );
}

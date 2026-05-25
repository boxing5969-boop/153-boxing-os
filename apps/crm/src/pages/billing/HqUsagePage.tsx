/**
 * 본사 (HQ) — 전체 tenant 운영 크레딧/사용량 요약.
 * RLS: super_admin / hq_admin / owner 만 데이터 반환.
 */
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { listTenantsForHq, type TenantUsageRow } from "@/services/billing";

const HQ_ROLES = ["super_admin", "hq_admin", "owner"];

function fmtKrw(n: number): string {
  return new Intl.NumberFormat("ko-KR").format(n) + "원";
}

export default function HqUsagePage() {
  const { profile } = useAuth();
  const allowed = profile?.role && HQ_ROLES.includes(profile.role);

  const [rows, setRows] = useState<TenantUsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await listTenantsForHq();
        if (cancelled) return;
        setRows(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  if (!allowed) {
    return (
      <div className="space-y-5">
        <PageHeader title="본사 운영 현황" />
        <Card className="p-5 text-sm text-slate-500">
          이 페이지는 본사 관리자(<code>super_admin</code> / <code>hq_admin</code> / <code>owner</code>) 권한이 필요합니다.
        </Card>
      </div>
    );
  }

  const totalBalance = rows.reduce((sum, r) => sum + r.balance_krw, 0);
  const suspended = rows.filter((r) => r.status !== "active");

  return (
    <div className="space-y-5">
      <PageHeader title="본사 운영 현황" description="전체 가맹점 크레딧 + 사용량 (Phase 20G 에서 월별 집계 추가)" />

      {error && <Card className="p-3 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</Card>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">가맹점</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{rows.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">총 잔액</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{fmtKrw(totalBalance)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">정지 / 취소</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{suspended.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">월 사용량</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">—</div>
          <div className="text-[11px] text-slate-400 mt-1">Phase 20G 에서 추가</div>
        </Card>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold">가맹점 상세</h2>
        </div>
        {loading ? (
          <div className="p-5 text-sm text-slate-400">불러오는 중…</div>
        ) : rows.length === 0 ? (
          <div className="p-5 text-sm text-slate-400">데이터가 없습니다.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map((r) => (
              <div key={r.tenant_id} className="px-5 py-3 flex items-center gap-3 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{r.tenant_name}</div>
                  <div className="text-[11px] text-slate-400">{r.tenant_id}</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold tabular-nums">{fmtKrw(r.balance_krw)}</div>
                  <div className="text-[11px] text-slate-400">잔액</div>
                </div>
                <Badge tone={r.status === "active" ? "success" : r.status === "suspended" ? "warning" : "danger"}>
                  {r.status === "active" ? "활성" : r.status === "suspended" ? "정지" : "취소"}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * 청구서 목록 (Payssam).
 * - 상태 필터 + 페이지네이션은 단순 limit
 * - 결제 완료 후 webhook 으로 status='paid' 갱신됨
 */
import { useEffect, useMemo, useState } from "react";
import { useBranch } from "@/contexts/BranchContext";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { listServiceInvoices, type ServiceInvoice } from "@/services/billing";

function fmtKrw(n: number): string {
  return new Intl.NumberFormat("ko-KR").format(n) + "원";
}
function fmtDate(s: string): string {
  return new Date(s).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

const STATUS_META: Record<ServiceInvoice["status"], { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" | "muted" }> = {
  draft:     { label: "임시저장", tone: "muted" },
  requested: { label: "요청 중",  tone: "info" },
  sent:      { label: "발송됨",   tone: "info" },
  paid:      { label: "결제완료", tone: "success" },
  failed:    { label: "발송 실패", tone: "danger" },
  cancelled: { label: "취소됨",   tone: "muted" },
};

export default function InvoicesListPage() {
  const { tenantId } = useBranch();
  const [items, setItems] = useState<ServiceInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await listServiceInvoices(tenantId, { status: statusFilter || undefined, limit: 100 });
        if (cancelled) return;
        setItems(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, statusFilter]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const i of items) m[i.status] = (m[i.status] ?? 0) + 1;
    return m;
  }, [items]);

  return (
    <div className="space-y-5">
      <PageHeader title="청구서 내역" description="결제선생 발행 청구서 + 결제 결과" />

      {error && <Card className="p-3 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</Card>}

      <Card className="p-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500">필터:</span>
        <button
          className={`px-2 py-1 rounded-md ring-1 ring-inset ${
            statusFilter === "" ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-600 ring-slate-200"
          }`}
          onClick={() => setStatusFilter("")}
        >
          전체 ({items.length})
        </button>
        {(["requested", "sent", "paid", "failed", "cancelled"] as const).map((s) => (
          <button
            key={s}
            className={`px-2 py-1 rounded-md ring-1 ring-inset ${
              statusFilter === s ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-600 ring-slate-200"
            }`}
            onClick={() => setStatusFilter(s)}
          >
            {STATUS_META[s].label} ({counts[s] ?? 0})
          </button>
        ))}
      </Card>

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-5 text-sm text-slate-400">불러오는 중…</div>
        ) : items.length === 0 ? (
          <div className="p-5 text-sm text-slate-400">청구서가 없습니다.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((inv) => {
              const meta = STATUS_META[inv.status] ?? STATUS_META.draft;
              return (
                <div key={inv.id} className="px-5 py-3 flex items-center gap-3 text-sm">
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium tabular-nums">{fmtKrw(inv.amount_krw)}</div>
                    <div className="text-[11px] text-slate-400">
                      {fmtDate(inv.created_at)} · 발송차감 {fmtKrw(inv.wallet_charge_krw)}
                    </div>
                    {inv.memo && <div className="text-[11px] text-slate-500 truncate">{inv.memo}</div>}
                  </div>
                  {inv.callback_received_at && (
                    <div className="text-[11px] text-emerald-600">
                      결제확인 {fmtDate(inv.callback_received_at)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

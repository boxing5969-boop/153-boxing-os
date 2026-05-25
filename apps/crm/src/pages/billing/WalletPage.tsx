/**
 * 운영 크레딧 (Service Wallet) 페이지.
 * - 현재 잔액 + 임계치 경고
 * - 최근 거래 내역
 * - 충전 placeholder (실제 PG 연동은 Phase 20F)
 */
import { useEffect, useState } from "react";
import { useBranch } from "@/contexts/BranchContext";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  getWallet,
  listActivePrices,
  listWalletTransactions,
  type ServiceWallet,
  type ServiceWalletTransaction,
  type UsagePrice,
} from "@/services/billing";

const LOW_BALANCE_THRESHOLD_KRW = 5_000;

function fmtKrw(n: number): string {
  return new Intl.NumberFormat("ko-KR").format(n) + "원";
}
function fmtDate(s: string): string {
  return new Date(s).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

const TYPE_LABEL: Record<string, { label: string; tone: "neutral" | "success" | "danger" | "info" | "warning" }> = {
  charge:     { label: "충전",     tone: "success" },
  refund:     { label: "환불",     tone: "info" },
  debit:      { label: "차감",     tone: "danger" },
  adjustment: { label: "조정",     tone: "warning" },
};

const USAGE_LABEL: Record<string, string> = {
  sms: "SMS",
  lms: "LMS",
  mms: "MMS",
  payssam_invoice: "결제 청구",
  alimtalk: "알림톡",
  kt_call_followup: "KT 후처리",
};

export default function WalletPage() {
  const { tenantId } = useBranch();
  const [wallet, setWallet] = useState<ServiceWallet | null>(null);
  const [transactions, setTransactions] = useState<ServiceWalletTransaction[]>([]);
  const [prices, setPrices] = useState<UsagePrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [w, tx, pr] = await Promise.all([
          getWallet(tenantId),
          listWalletTransactions(tenantId, 30),
          listActivePrices(),
        ]);
        if (cancelled) return;
        setWallet(w);
        setTransactions(tx);
        setPrices(pr);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const balance = wallet?.balance_krw ?? 0;
  const isLow = balance < LOW_BALANCE_THRESHOLD_KRW;

  return (
    <div className="space-y-5">
      <PageHeader title="운영 크레딧" description="문자·청구서 발송 시 차감되는 선불 잔액" />

      {error && (
        <Card className="p-4 border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</Card>
      )}

      {/* 잔액 카드 */}
      <Card className="p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500">잔액</div>
            <div className="mt-1 text-3xl sm:text-4xl font-bold tabular-nums">
              {loading ? "—" : fmtKrw(balance)}
            </div>
            {isLow && !loading && (
              <div className="mt-2">
                <Badge tone="warning">잔액 부족 — 발송 전 충전 필요</Badge>
              </div>
            )}
            <p className="mt-3 text-xs text-slate-500 leading-relaxed max-w-md">
              SMS/LMS/MMS 문자 발송과 결제 청구서 발송 시 본 잔액에서 자동 차감됩니다.
              외부 발송 실패 시 즉시 환불 처리됩니다.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled
              title="Phase 20F (결제선생 연동) 후 활성화"
              className="text-xs"
            >
              크레딧 충전 (준비중)
            </Button>
          </div>
        </div>
      </Card>

      {/* 단가 안내 */}
      {prices.length > 0 && (
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-3">건당 차감 단가</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {prices.map((p) => (
              <div key={p.usage_type} className="rounded-md border border-slate-200 px-3 py-2">
                <div className="text-[11px] text-slate-500">{USAGE_LABEL[p.usage_type] ?? p.usage_type}</div>
                <div className="text-sm font-semibold tabular-nums">{fmtKrw(p.charge_krw)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 최근 거래 */}
      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold">최근 거래</h2>
          <span className="text-xs text-slate-400">최대 30건</span>
        </div>
        {loading ? (
          <div className="p-5 text-sm text-slate-400">불러오는 중…</div>
        ) : transactions.length === 0 ? (
          <div className="p-5 text-sm text-slate-400">거래 내역이 없습니다.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {transactions.map((t) => {
              const meta = TYPE_LABEL[t.type] ?? { label: t.type, tone: "neutral" as const };
              return (
                <div key={t.id} className="flex items-center gap-3 px-4 sm:px-5 py-3">
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">
                      {t.usage_type ? USAGE_LABEL[t.usage_type] ?? t.usage_type : t.memo ?? "—"}
                    </div>
                    <div className="text-[11px] text-slate-400">{fmtDate(t.created_at)}</div>
                  </div>
                  <div className="text-right tabular-nums">
                    <div
                      className={
                        t.amount_krw < 0 ? "text-rose-600 font-semibold" : "text-emerald-600 font-semibold"
                      }
                    >
                      {t.amount_krw < 0 ? "" : "+"}
                      {fmtKrw(t.amount_krw)}
                    </div>
                    <div className="text-[11px] text-slate-400">잔액 {fmtKrw(t.balance_after_krw)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

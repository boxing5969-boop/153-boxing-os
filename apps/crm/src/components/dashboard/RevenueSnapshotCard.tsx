import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, ArrowRight, BarChart3 } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { getRevenueSummary } from "@/services/finance";
import { cn } from "@/lib/cn";

function monthRange(offset: number = 0): { from: string; to: string; label: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1 + offset;
  const date = new Date(y, m - 1, 1);
  const from = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const to = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
  const label = `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
  return { from, to, label };
}

function formatKrw(n: number) {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString("ko-KR")}만`;
  return n.toLocaleString("ko-KR");
}

function StatItem({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-black text-foreground tabular">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function RevenueSnapshotCard() {
  const thisMonth = monthRange(0);
  const lastMonth = monthRange(-1);

  const thisQ = useQuery({
    queryKey: ["revenue-snapshot-this", thisMonth.from],
    queryFn: () => getRevenueSummary(thisMonth.from, thisMonth.to),
    staleTime: 120_000,
  });
  const lastQ = useQuery({
    queryKey: ["revenue-snapshot-last", lastMonth.from],
    queryFn: () => getRevenueSummary(lastMonth.from, lastMonth.to),
    staleTime: 300_000,
  });

  const thisPaid  = thisQ.data?.paid_total ?? 0;
  const lastPaid  = lastQ.data?.paid_total ?? 0;
  const thisCount = thisQ.data?.paid_count ?? 0;
  const unpaid    = thisQ.data?.unpaid_total ?? 0;

  const diff = lastPaid > 0 ? Math.round(((thisPaid - lastPaid) / lastPaid) * 100) : null;
  const isUp = diff != null && diff >= 0;
  const loading = thisQ.isLoading || lastQ.isLoading;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-primary/10">
              <BarChart3 className="size-3.5 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">매출 현황</h2>
              <p className="text-xs text-muted-foreground">{thisMonth.label}</p>
            </div>
          </div>
          <Link
            to="/admin/revenue"
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            자세히 <ArrowRight className="size-3" />
          </Link>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            {/* 이번달 결제 총액 */}
            <div className="flex items-end justify-between rounded-xl bg-primary/5 border border-primary/10 px-4 py-3">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">이번달 결제 완료</p>
                <p className="text-2xl font-black text-foreground tabular">
                  {formatKrw(thisPaid)}원
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{thisCount}건</p>
              </div>
              {diff != null && (
                <div className={cn(
                  "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold",
                  isUp
                    ? "bg-success/10 text-success"
                    : "bg-danger/10 text-danger"
                )}>
                  {isUp
                    ? <TrendingUp className="size-3.5" />
                    : <TrendingDown className="size-3.5" />}
                  {isUp ? "+" : ""}{diff}%
                </div>
              )}
            </div>

            {/* 지난달 / 미납 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border bg-card px-3 py-2.5">
                <StatItem
                  label={`${lastMonth.label} 매출`}
                  value={`${formatKrw(lastPaid)}원`}
                  sub={`${lastQ.data?.paid_count ?? 0}건`}
                />
              </div>
              <div className={cn(
                "rounded-xl border px-3 py-2.5",
                unpaid > 0 ? "border-danger/20 bg-danger/5" : "border-border bg-card"
              )}>
                <StatItem
                  label="이번달 미납"
                  value={unpaid > 0 ? `${formatKrw(unpaid)}원` : "없음"}
                  sub={unpaid > 0 ? `${thisQ.data?.unpaid_count ?? 0}건` : undefined}
                />
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

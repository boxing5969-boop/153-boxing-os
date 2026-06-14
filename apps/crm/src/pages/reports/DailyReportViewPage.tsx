import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { getOverview, getTrend, type OverviewBranch, type TrendRow } from "@/services/dailyReports";

function todayKst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function won(n: number): string {
  return n.toLocaleString("ko-KR");
}

const SERIES = [
  { key: "pt", label: "PT", color: "#2563eb" },
  { key: "membership", label: "수강", color: "#16a34a" },
  { key: "goods", label: "물품", color: "#d97706" },
  { key: "dan", label: "단증", color: "#9333ea" },
] as const;

export default function DailyReportViewPage() {
  const [date, setDate] = useState<string>(todayKst());
  const [rows, setRows] = useState<OverviewBranch[]>([]);
  const [selBranch, setSelBranch] = useState<string>("");
  const [trend, setTrend] = useState<TrendRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    getOverview(date)
      .then((d) => {
        setRows(d.branches);
        setSelBranch((cur) => cur || (d.branches[0]?.branch_id ?? ""));
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "불러오기 실패"));
  }, [date]);

  useEffect(() => {
    if (!selBranch) return;
    const y = Number(date.slice(0, 4));
    const m = Number(date.slice(5, 7));
    getTrend(selBranch, y, m).then((d) => setTrend(d.rows)).catch(() => setTrend([]));
  }, [selBranch, date]);

  const chartData = trend.map((r) => ({
    day: Number(r.report_date.slice(8, 10)),
    pt: r.revenue_pt, membership: r.revenue_membership, goods: r.revenue_goods, dan: r.revenue_dan,
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">일일 리포트 현황 (전 지점)</h1>
          <p className="text-sm text-muted-foreground">날짜 기준 지점 비교 · 월 누적 추이</p>
        </div>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
      </div>

      {err && <p className="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">{err}</p>}

      {/* 지점 비교 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((b) => {
          const pct = b.achievement != null ? Math.round(b.achievement * 100) : null;
          return (
            <Card key={b.branch_id}>
              <CardContent className="pt-5 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-foreground">{b.branch_name}</p>
                  <span className="text-xs text-muted-foreground">D-{b.d_day}</span>
                </div>
                <p className="text-2xl font-bold tabular text-primary">
                  {won(b.day_total)}<span className="text-sm font-medium text-muted-foreground">원 (당일)</span>
                </p>
                <div className="text-xs text-muted-foreground">
                  누적 {won(b.month_cumulative)} / 목표 {won(b.target_amount)}원
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-success" style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
                </div>
                <p className="text-xs font-medium">
                  {pct != null ? `${pct}% 달성` : "목표 미설정"} · Gap {won(b.gap)}원
                </p>
              </CardContent>
            </Card>
          );
        })}
        {rows.length === 0 && !err && <p className="text-sm text-muted-foreground">데이터가 없습니다.</p>}
      </div>

      {/* 월 누적 추이 */}
      <Card>
        <CardContent className="pt-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold">월 매출 추이 (4분류 스택)</p>
            <select value={selBranch} onChange={(e) => setSelBranch(e.target.value)}
              className="h-9 rounded-lg border border-border bg-background px-2 text-sm">
              {rows.map((b) => <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>)}
            </select>
          </div>
          <div style={{ width: "100%", height: 300 }}>
            <ResponsiveContainer>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="day" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v) => `${Math.round(Number(v) / 10000)}만`} />
                <Tooltip formatter={(v: number) => `${won(v)}원`} />
                <Legend />
                {SERIES.map((s) => (
                  <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * 체성분 측정 카드
 * - 최신 측정치 요약
 * - 체중/체지방률 꺾은선 차트 (recharts)
 * - 측정 이력 테이블
 * - 새 측정 추가 인라인 폼
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Activity, ChevronDown, ChevronUp } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import {
  listMeasurements, createMeasurement, deleteMeasurement,
  type BodyMeasurement,
} from "@/services/fitness";
import { cn } from "@/lib/cn";

interface Props { memberId: string; }

interface FormState {
  measured_at: string;
  weight_kg: string;
  body_fat_pct: string;
  muscle_mass_kg: string;
  bmi: string;
  note: string;
}

const emptyForm = (): FormState => ({
  measured_at: new Date().toISOString().slice(0, 10),
  weight_kg: "",
  body_fat_pct: "",
  muscle_mass_kg: "",
  bmi: "",
  note: "",
});

function toNum(v: string): number | null {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function latest(measurements: BodyMeasurement[], key: keyof BodyMeasurement): number | null {
  for (const m of measurements) {
    const v = m[key];
    if (v != null) return v as number;
  }
  return null;
}

function StatChip({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-border bg-muted/30 px-3 py-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-lg font-black text-foreground tabular">
        {value != null ? value : "—"}
        {value != null && <span className="text-xs font-normal text-muted-foreground ml-0.5">{unit}</span>}
      </p>
    </div>
  );
}

export function BodyMeasurementsCard({ memberId }: Props) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formErr, setFormErr] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["body-measurements", memberId],
    queryFn: () => listMeasurements(memberId),
    staleTime: 60_000,
  });

  const addMutation = useMutation({
    mutationFn: (f: FormState) =>
      createMeasurement(memberId, {
        measured_at:    f.measured_at,
        weight_kg:      toNum(f.weight_kg),
        body_fat_pct:   toNum(f.body_fat_pct),
        muscle_mass_kg: toNum(f.muscle_mass_kg),
        bmi:            toNum(f.bmi),
        note:           f.note || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["body-measurements", memberId] });
      setShowForm(false);
      setForm(emptyForm());
      setFormErr(null);
    },
    onError: (err) => setFormErr(err instanceof Error ? err.message : "저장 실패"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteMeasurement,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["body-measurements", memberId] }),
  });

  const measurements = data ?? [];
  // 차트용 데이터: 오래된 순
  const chartData = [...measurements].reverse().slice(-12).map((m) => ({
    date: m.measured_at.slice(5), // MM-DD
    weight: m.weight_kg,
    fat:    m.body_fat_pct,
    muscle: m.muscle_mass_kg,
  }));

  const displayed = showAll ? measurements : measurements.slice(0, 5);

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Activity className="size-4 text-muted-foreground" />
          체성분 기록
        </h2>
        <Button size="sm" variant="outline" onClick={() => setShowForm((v) => !v)} className="gap-1.5">
          <Plus className="size-3.5" />
          측정 추가
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 인라인 입력 폼 */}
        {showForm && (
          <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">측정일</span>
                <input
                  type="date"
                  value={form.measured_at}
                  onChange={(e) => setForm((f) => ({ ...f, measured_at: e.target.value }))}
                  className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
              {(
                [
                  { key: "weight_kg",      label: "체중 (kg)",      placeholder: "예: 72.5" },
                  { key: "body_fat_pct",   label: "체지방률 (%)",    placeholder: "예: 18.4" },
                  { key: "muscle_mass_kg", label: "골격근량 (kg)",   placeholder: "예: 34.0" },
                  { key: "bmi",            label: "BMI",             placeholder: "예: 23.1" },
                ] as const
              ).map(({ key, label, placeholder }) => (
                <label key={key} className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <input
                    type="number"
                    step="0.1"
                    placeholder={placeholder}
                    value={form[key]}
                    onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                    className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
              ))}
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-muted-foreground">메모</span>
              <input
                type="text"
                placeholder="특이사항 (선택)"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            {formErr && <p className="text-xs text-danger">{formErr}</p>}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => addMutation.mutate(form)}
                disabled={addMutation.isPending}
              >
                {addMutation.isPending ? "저장 중…" : "저장"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowForm(false); setFormErr(null); }}>
                취소
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="h-32 animate-pulse rounded-lg bg-muted" />
        ) : measurements.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">측정 기록이 없습니다</p>
        ) : (
          <>
            {/* 최신 수치 요약 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatChip label="체중"      value={latest(measurements, "weight_kg")}      unit="kg" />
              <StatChip label="체지방률"  value={latest(measurements, "body_fat_pct")}   unit="%" />
              <StatChip label="골격근량"  value={latest(measurements, "muscle_mass_kg")} unit="kg" />
              <StatChip label="BMI"        value={latest(measurements, "bmi")}             unit="" />
            </div>

            {/* 차트 */}
            {chartData.length >= 2 && (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={chartData} margin={{ top: 4, right: 16, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="weight" tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                  <YAxis yAxisId="fat" orientation="right" tick={{ fontSize: 11 }} domain={["auto", "auto"]} unit="%" />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    formatter={(value: number, name: string) =>
                      name === "체지방%" ? [`${value}%`, name] : [`${value}kg`, name]
                    }
                  />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    yAxisId="weight"
                    type="monotone"
                    dataKey="weight"
                    name="체중(kg)"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                  <Line
                    yAxisId="fat"
                    type="monotone"
                    dataKey="fat"
                    name="체지방%"
                    stroke="var(--warning)"
                    strokeWidth={2}
                    strokeDasharray="4 2"
                    dot={{ r: 3 }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            )}

            {/* 이력 테이블 */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-1.5 pr-3 font-medium">날짜</th>
                    <th className="text-right py-1.5 px-2 font-medium">체중</th>
                    <th className="text-right py-1.5 px-2 font-medium">체지방%</th>
                    <th className="text-right py-1.5 px-2 font-medium">근육</th>
                    <th className="text-right py-1.5 px-2 font-medium">BMI</th>
                    <th className="text-left py-1.5 px-2 font-medium">메모</th>
                    <th className="py-1.5 w-6" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {displayed.map((m) => (
                    <tr key={m.id} className="hover:bg-muted/30">
                      <td className="py-1.5 pr-3 tabular text-muted-foreground">{m.measured_at}</td>
                      <td className="py-1.5 px-2 text-right tabular font-medium">{m.weight_kg ?? "—"}</td>
                      <td className="py-1.5 px-2 text-right tabular">{m.body_fat_pct != null ? `${m.body_fat_pct}%` : "—"}</td>
                      <td className="py-1.5 px-2 text-right tabular">{m.muscle_mass_kg ?? "—"}</td>
                      <td className="py-1.5 px-2 text-right tabular">{m.bmi ?? "—"}</td>
                      <td className="py-1.5 px-2 text-muted-foreground max-w-[120px] truncate">{m.note ?? ""}</td>
                      <td className="py-1.5">
                        <button
                          onClick={() => deleteMutation.mutate(m.id)}
                          className="text-muted-foreground hover:text-danger transition-colors"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {measurements.length > 5 && (
              <button
                onClick={() => setShowAll((v) => !v)}
                className={cn(
                  "flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto"
                )}
              >
                {showAll
                  ? <><ChevronUp className="size-3" /> 접기</>
                  : <><ChevronDown className="size-3" /> 전체 보기 ({measurements.length}건)</>}
              </button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * 운동 일지 카드
 * - 최근 운동 기록 목록
 * - 새 운동 기록 인라인 폼
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Dumbbell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import {
  listWorkouts, createWorkout, deleteWorkout,
  INTENSITY_LABELS, INTENSITY_COLORS,
  type WorkoutIntensity,
} from "@/services/fitness";
import { cn } from "@/lib/cn";

interface Props { memberId: string; }

interface FormState {
  logged_date:  string;
  duration_min: string;
  intensity:    WorkoutIntensity | "";
  note:         string;
}

const emptyForm = (): FormState => ({
  logged_date:  new Date().toISOString().slice(0, 10),
  duration_min: "",
  intensity:    "",
  note:         "",
});

export function WorkoutLogsCard({ memberId }: Props) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formErr, setFormErr] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["workout-logs", memberId],
    queryFn: () => listWorkouts(memberId),
    staleTime: 60_000,
  });

  const addMutation = useMutation({
    mutationFn: (f: FormState) =>
      createWorkout(memberId, {
        logged_date:  f.logged_date,
        duration_min: f.duration_min ? parseInt(f.duration_min, 10) : null,
        intensity:    (f.intensity as WorkoutIntensity) || null,
        note:         f.note || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["workout-logs", memberId] });
      setShowForm(false);
      setForm(emptyForm());
      setFormErr(null);
    },
    onError: (err) => setFormErr(err instanceof Error ? err.message : "저장 실패"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteWorkout,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["workout-logs", memberId] }),
  });

  const logs = data ?? [];

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Dumbbell className="size-4 text-muted-foreground" />
          운동 일지
        </h2>
        <Button size="sm" variant="outline" onClick={() => setShowForm((v) => !v)} className="gap-1.5">
          <Plus className="size-3.5" />
          기록 추가
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* 인라인 입력 폼 */}
        {showForm && (
          <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">날짜</span>
                <input
                  type="date"
                  value={form.logged_date}
                  onChange={(e) => setForm((f) => ({ ...f, logged_date: e.target.value }))}
                  className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">운동 시간 (분)</span>
                <input
                  type="number"
                  placeholder="예: 60"
                  min={1}
                  max={480}
                  value={form.duration_min}
                  onChange={(e) => setForm((f) => ({ ...f, duration_min: e.target.value }))}
                  className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">강도</span>
                <select
                  value={form.intensity}
                  onChange={(e) => setForm((f) => ({ ...f, intensity: e.target.value as WorkoutIntensity | "" }))}
                  className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">선택 안 함</option>
                  <option value="light">가벼움</option>
                  <option value="moderate">보통</option>
                  <option value="intense">강도 높음</option>
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-muted-foreground">운동 내용 / 특이사항</span>
              <textarea
                placeholder="예: 줄넘기 300개, 미트 타격 10라운드, 스파링 3라운드"
                rows={2}
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
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

        {/* 일지 목록 */}
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">운동 기록이 없습니다</p>
        ) : (
          <ul className="divide-y divide-border">
            {logs.map((log) => (
              <li key={log.id} className="flex items-start gap-3 py-3">
                {/* 날짜 */}
                <div className="shrink-0 text-center">
                  <p className="text-xs text-muted-foreground tabular">{log.logged_date.slice(5)}</p>
                  <p className="text-[10px] text-muted-foreground/60">{log.logged_date.slice(0, 4)}</p>
                </div>

                {/* 내용 */}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {log.duration_min != null && (
                      <span className="text-xs font-medium text-foreground">
                        {log.duration_min}분
                      </span>
                    )}
                    {log.intensity && (
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        INTENSITY_COLORS[log.intensity]
                      )}>
                        {INTENSITY_LABELS[log.intensity]}
                      </span>
                    )}
                    {log.staff?.name && (
                      <span className="text-[10px] text-muted-foreground">
                        코치: {log.staff.name}
                      </span>
                    )}
                  </div>
                  {log.note && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{log.note}</p>
                  )}
                </div>

                {/* 삭제 */}
                <button
                  onClick={() => deleteMutation.mutate(log.id)}
                  className="shrink-0 text-muted-foreground hover:text-danger transition-colors mt-0.5"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

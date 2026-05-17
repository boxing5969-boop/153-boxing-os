import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Dumbbell } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { checkInSession } from "@/services/sessions";
import { cn } from "@/lib/cn";
import type { Membership } from "@153/shared";

interface Props {
  open: boolean;
  onClose: () => void;
  membership: Membership;
  memberId: string;
}

function SessionBar({ used, max }: { used: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">사용 횟수</span>
        <span className="font-semibold text-foreground">{used} / {max}회</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-warning" : "bg-primary"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {max - used}회 남음
      </p>
    </div>
  );
}

export function CheckInDialog({ open, onClose, membership, memberId }: Props) {
  const qc = useQueryClient();
  const [done, setDone] = useState(false);
  const [result, setResult] = useState<{ used: number; max: number; remaining: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const used    = membership.used_sessions ?? 0;
  const max     = membership.max_sessions ?? 0;
  const canCheckIn = used < max;

  const mutation = useMutation({
    mutationFn: () => checkInSession(membership.id),
    onSuccess: (data) => {
      setResult({ used: data.used_sessions, max: data.max_sessions, remaining: data.remaining });
      setDone(true);
      void qc.invalidateQueries({ queryKey: ["member-related", memberId] });
      void qc.invalidateQueries({ queryKey: ["memberships"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "출석 처리 실패"),
  });

  function handleClose() {
    setDone(false);
    setResult(null);
    setError(null);
    onClose();
  }

  return (
    <Dialog open={open} onClose={handleClose} title="출석 체크">
      <div className="space-y-5">

        {/* 이용권 정보 */}
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 space-y-1">
          <p className="text-sm font-semibold text-foreground">{membership.plan_name}</p>
          <p className="text-xs text-muted-foreground tabular">
            {membership.start_date} ~ {membership.end_date}
          </p>
        </div>

        {/* 성공 화면 */}
        {done && result && (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="flex size-16 items-center justify-center rounded-full bg-success/15">
              <CheckCircle2 className="size-8 text-success" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-lg font-black text-foreground">출석 완료!</p>
              <p className="text-sm text-muted-foreground">
                {result.remaining > 0
                  ? `${result.remaining}회 남았습니다`
                  : "마지막 횟수를 사용했습니다"}
              </p>
            </div>
            <div className="w-full">
              <SessionBar used={result.used} max={result.max} />
            </div>
            <Button onClick={handleClose} className="w-full">닫기</Button>
          </div>
        )}

        {/* 기본 화면 */}
        {!done && (
          <>
            {/* 현재 횟수 현황 */}
            <SessionBar used={used} max={max} />

            {!canCheckIn && (
              <div className="flex items-center gap-2 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2.5">
                <div className="size-1.5 rounded-full bg-danger shrink-0" />
                <p className="text-sm text-danger font-medium">남은 횟수가 없습니다</p>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2.5">
                <div className="size-1.5 rounded-full bg-danger shrink-0" />
                <p className="text-sm text-danger">{error}</p>
              </div>
            )}

            <div className="flex flex-col gap-2 pt-1">
              <Button
                onClick={() => mutation.mutate()}
                disabled={!canCheckIn || mutation.isPending}
                className="w-full gap-2 py-5 text-base font-bold"
              >
                {mutation.isPending ? (
                  <>
                    <span className="size-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    처리 중…
                  </>
                ) : (
                  <>
                    <Dumbbell className="size-5" />
                    출석 체크 (1회 차감)
                  </>
                )}
              </Button>
              <Button variant="ghost" onClick={handleClose} disabled={mutation.isPending}>
                취소
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

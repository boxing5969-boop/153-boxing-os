import { type FormEvent, useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Play, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog } from "@/components/ui/dialog";
import { resumeMembershipHold } from "@/services/memberships";
import type { Membership } from "@153/shared";

interface Props {
  open: boolean;
  onClose: () => void;
  membership: Membership;
  memberId: string;
}

function todayIso() { return new Date().toISOString().slice(0, 10); }

export function ResumeMembershipDialog({ open, onClose, membership, memberId }: Props) {
  const qc = useQueryClient();
  const [resumeDate, setResumeDate] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setResumeDate(todayIso());
      setError(null);
    }
  }, [open]);

  // 홀딩 시작일 기준 홀딩 일수 미리보기
  const holdStart = membership.hold_start ?? null;
  const previewDays =
    holdStart && resumeDate && resumeDate >= holdStart
      ? Math.max(0, Math.ceil((new Date(resumeDate).getTime() - new Date(holdStart).getTime()) / 86400000))
      : null;

  // 연장 후 예상 종료일
  const previewNewEnd =
    previewDays != null
      ? new Date(
          new Date(membership.end_date).getTime() + previewDays * 86400000
        )
          .toISOString()
          .slice(0, 10)
      : null;

  const mutation = useMutation({
    mutationFn: () =>
      resumeMembershipHold(membership.id, resumeDate !== todayIso() ? resumeDate : undefined),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ["member-related", memberId] });
      void qc.invalidateQueries({ queryKey: ["memberships"] });
      void qc.invalidateQueries({ queryKey: ["access-preview", memberId] });
      console.log("[ResumeHold] 완료:", result);
      onClose();
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "홀딩 해제 실패";
      setError(
        msg.includes("NOT_ON_HOLD") ? "현재 홀딩 중인 이용권이 아닙니다."
        : msg.includes("HOLD_RECORD_NOT_FOUND") ? "홀딩 이력을 찾을 수 없습니다."
        : msg.includes("MEMBERSHIP_NOT_FOUND") ? "이용권을 찾을 수 없습니다."
        : msg
      );
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  }

  return (
    <Dialog open={open} onClose={onClose} title="홀딩 해제 (재개)">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
        {/* 대상 이용권 */}
        <div className="rounded-lg bg-primary/10 border border-primary/30 px-4 py-3 flex items-start gap-3">
          <Play className="size-4 text-primary mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">{membership.plan_name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {membership.start_date} ~ {membership.end_date}
            </p>
            {holdStart && (
              <p className="text-xs text-warning mt-0.5">
                홀딩 시작일: <span className="font-semibold">{holdStart}</span>
                {membership.hold_end && (
                  <span className="ml-2">→ 예정 종료: {membership.hold_end}</span>
                )}
              </p>
            )}
          </div>
        </div>

        {/* 재개일 */}
        <div className="space-y-1.5">
          <Label htmlFor="resume-date">
            재개일
            <span className="ml-1 text-xs text-muted-foreground font-normal">(기본값: 오늘)</span>
          </Label>
          <Input
            id="resume-date"
            type="date"
            min={holdStart ?? todayIso()}
            value={resumeDate}
            onChange={(e) => setResumeDate(e.target.value)}
            required
          />
        </div>

        {/* 홀딩 일수 및 연장 미리보기 */}
        {previewDays != null && previewNewEnd && (
          <div className="rounded-lg bg-muted/60 px-4 py-3 space-y-1.5">
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="size-4 text-primary shrink-0" />
              <span className="text-muted-foreground">
                홀딩 기간:{" "}
                <strong className="text-foreground">{previewDays}일</strong>
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="size-4 shrink-0" />
              <span className="text-muted-foreground">
                이용권 종료일이{" "}
                <strong className="text-foreground">{previewNewEnd}</strong>
                으로 연장됩니다.
              </span>
            </div>
          </div>
        )}

        {previewDays === 0 && (
          <div className="rounded-lg bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
            재개일이 홀딩 시작일과 같으면 이용권 종료일이 연장되지 않습니다.
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2.5">
            <div className="size-1.5 rounded-full bg-danger shrink-0" />
            <p className="text-sm text-danger">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            취소
          </Button>
          <Button
            type="submit"
            disabled={mutation.isPending}
            className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {mutation.isPending ? (
              <><span className="size-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> 처리 중…</>
            ) : (
              <><Play className="size-4" /> 홀딩 해제</>
            )}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

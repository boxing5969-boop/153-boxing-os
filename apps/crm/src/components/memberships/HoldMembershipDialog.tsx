import { type FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pause, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog } from "@/components/ui/dialog";
import { startMembershipHold } from "@/services/memberships";
import type { Membership } from "@153/shared";

interface Props {
  open: boolean;
  onClose: () => void;
  membership: Membership;
  memberId: string;
}

function todayIso() { return new Date().toISOString().slice(0, 10); }

export function HoldMembershipDialog({ open, onClose, membership, memberId }: Props) {
  if (!open) return null;
  return <HoldMembershipDialogBody onClose={onClose} membership={membership} memberId={memberId} />;
}

function HoldMembershipDialogBody({ onClose, membership, memberId }: Omit<Props, "open">) {
  const qc = useQueryClient();
  const [holdStart, setHoldStart] = useState(todayIso());
  const [holdEnd, setHoldEnd] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  // 홀딩 기간 (일) 미리보기
  const previewDays =
    holdEnd && holdStart && holdEnd > holdStart
      ? Math.ceil((new Date(holdEnd).getTime() - new Date(holdStart).getTime()) / 86400000)
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
      startMembershipHold({
        membership_id: membership.id,
        hold_start:    holdStart,
        hold_end:      holdEnd || undefined,
        reason:        reason || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["member-related", memberId] });
      void qc.invalidateQueries({ queryKey: ["memberships"] });
      void qc.invalidateQueries({ queryKey: ["access-preview", memberId] });
      onClose();
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "홀딩 처리 실패";
      setError(msg.includes("ALREADY_ON_HOLD") ? "이미 홀딩 중인 이용권입니다."
        : msg.includes("NOT_ACTIVE") ? "활성 이용권만 홀딩할 수 있습니다."
        : msg.includes("INVALID_DATE") ? "홀딩 시작일은 오늘 이후여야 합니다."
        : msg);
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  }

  return (
    <Dialog open={true} onClose={onClose} title="이용권 홀딩">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
        {/* 대상 이용권 */}
        <div className="rounded-lg bg-warning/10 border border-warning/30 px-4 py-3 flex items-start gap-3">
          <Pause className="size-4 text-warning mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-foreground">{membership.plan_name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {membership.start_date} ~ {membership.end_date}
            </p>
          </div>
        </div>

        {/* 홀딩 기간 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="hold-start">홀딩 시작일 <span className="text-danger">*</span></Label>
            <Input
              id="hold-start"
              type="date"
              required
              min={todayIso()}
              value={holdStart}
              onChange={(e) => setHoldStart(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hold-end">
              홀딩 종료일
              <span className="ml-1 text-xs text-muted-foreground font-normal">(미입력 = 무기한)</span>
            </Label>
            <Input
              id="hold-end"
              type="date"
              min={holdStart}
              value={holdEnd}
              onChange={(e) => setHoldEnd(e.target.value)}
            />
          </div>
        </div>

        {/* 연장 예상 안내 */}
        {previewDays != null && previewNewEnd && (
          <div className="rounded-lg bg-muted/60 px-4 py-3 flex items-center gap-2 text-sm">
            <Calendar className="size-4 text-primary shrink-0" />
            <span className="text-muted-foreground">
              홀딩 {previewDays}일 → 이용권 종료일이{" "}
              <strong className="text-foreground">{previewNewEnd}</strong>으로 연장됩니다.
            </span>
          </div>
        )}

        {/* 사유 */}
        <div className="space-y-1.5">
          <Label htmlFor="hold-reason">
            홀딩 사유
            <span className="ml-1 text-xs text-muted-foreground font-normal">(선택)</span>
          </Label>
          <Input
            id="hold-reason"
            placeholder="예: 부상, 해외 출장, 개인 사정…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={100}
          />
        </div>

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
            className="gap-2 bg-warning text-warning-foreground hover:bg-warning/90"
          >
            {mutation.isPending ? (
              <><span className="size-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> 처리 중…</>
            ) : (
              <><Pause className="size-4" /> 홀딩 시작</>
            )}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

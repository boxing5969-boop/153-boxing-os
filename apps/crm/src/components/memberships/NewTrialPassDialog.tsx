import { type FormEvent, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { createTrialPass } from "@/services/trialPasses";
import type { Member } from "@153/shared";

interface Props {
  open: boolean;
  onClose: () => void;
  member: Member;
}

function nowLocalIso(): string {
  // datetime-local 입력에 맞는 형식 (YYYY-MM-DDTHH:mm)
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function addDaysToLocal(localIso: string, days: number): string {
  const d = new Date(localIso);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function NewTrialPassDialog({ open, onClose, member }: Props) {
  if (!open) return null;
  return <NewTrialPassDialogBody onClose={onClose} member={member} />;
}

function NewTrialPassDialogBody({ onClose, member }: Omit<Props, "open">) {
  const qc = useQueryClient();
  const [startAt, setStartAt] = useState(nowLocalIso());
  const [days, setDays] = useState(7);
  const [maxEntries, setMaxEntries] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const endAt = useMemo(() => addDaysToLocal(startAt, days), [startAt, days]);

  const mutation = useMutation({
    mutationFn: createTrialPass,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["trialPasses"] });
      void qc.invalidateQueries({ queryKey: ["member-related", member.id] });
      void qc.invalidateQueries({ queryKey: ["access-preview", member.id] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "발급 실패"),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (days < 1 || maxEntries < 1) {
      setError("기간/횟수는 1 이상이어야 합니다");
      return;
    }
    mutation.mutate({
      member_id: member.id,
      branch_id: member.branch_id,
      start_at: new Date(startAt).toISOString(),
      end_at: new Date(endAt).toISOString(),
      max_entries: maxEntries,
    });
  }

  return (
    <Dialog open={true} onClose={onClose} title={`체험권 발급 — ${member.name}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="start_at">시작 일시</Label>
          <Input
            id="start_at"
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="days">유효 기간 (일)</Label>
            <Input
              id="days"
              type="number"
              min={1}
              max={90}
              value={days}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isNaN(v)) setDays(v);
              }}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="entries">최대 사용 횟수</Label>
            <Input
              id="entries"
              type="number"
              min={1}
              max={50}
              value={maxEntries}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isNaN(v)) setMaxEntries(v);
              }}
              required
            />
          </div>
        </div>
        <p className="text-xs opacity-70">종료 일시: {endAt.replace("T", " ")}</p>
        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "발급 중…" : "발급"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

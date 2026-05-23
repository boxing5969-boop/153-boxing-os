import { type FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { linkRankingAppUser } from "@/services/members";
import type { Member } from "@153/shared";

interface Props {
  open: boolean;
  onClose: () => void;
  member: Member;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function LinkRankingAppDialog({ open, onClose, member }: Props) {
  if (!open) return null;
  return <LinkRankingAppDialogBody onClose={onClose} member={member} />;
}

function LinkRankingAppDialogBody({ onClose, member }: Omit<Props, "open">) {
  const qc = useQueryClient();
  const [rankingId, setRankingId] = useState(member.ranking_app_user_id ?? "");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (id: string | null) => linkRankingAppUser(member.id, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["member", member.id] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "저장 실패"),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = rankingId.trim();
    if (trimmed && !UUID_RE.test(trimmed)) {
      setError("uuid 형식이어야 합니다 (또는 비워두면 연결 해제)");
      return;
    }
    mutation.mutate(trimmed || null);
  }

  return (
    <Dialog open={true} onClose={onClose} title="랭킹업앱 연결">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="rid">랭킹업 user.id (uuid)</Label>
          <Input
            id="rid"
            value={rankingId}
            onChange={(e) => setRankingId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            autoFocus
          />
          <p className="text-xs opacity-60">
            랭킹업앱 회원의 Supabase auth user.id 를 입력합니다. 비워두면 연결이 해제됩니다.
          </p>
        </div>
        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "저장 중…" : "저장"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

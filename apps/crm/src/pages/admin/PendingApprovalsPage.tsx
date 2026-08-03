import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UserCheck, Check, X } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { roleLabel } from "@/lib/roleLabels";
import { formatDate } from "@/lib/format";
import { getPendingApprovals, decideApproval } from "@/services/branchApprovals";

export default function PendingApprovalsPage() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: pending = [], isLoading } = useQuery({
    queryKey: ["pending-approvals"],
    queryFn: getPendingApprovals,
    refetchInterval: 30_000,
  });

  const mutation = useMutation({
    mutationFn: (v: { id: string; action: "approve" | "reject" }) =>
      decideApproval(v.id, v.action),
    onMutate: (v) => { setBusyId(v.id); setError(null); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pending-approvals"] }),
    onError: (e) => setError(e instanceof Error ? e.message : "처리 실패"),
    onSettled: () => setBusyId(null),
  });

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        title="가입 승인"
        description="지점 직원의 가입 신청을 승인하거나 거절합니다 (본사 전용)"
        badge={
          pending.length > 0 ? (
            <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-bold text-warning">
              {pending.length}건 대기
            </span>
          ) : undefined
        }
      />

      {error && (
        <p className="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>
      )}

      {isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">불러오는 중…</Card>
      ) : pending.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <UserCheck className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">대기 중인 가입 신청이 없습니다.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {pending.map((p) => (
            <Card key={p.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="font-semibold text-foreground">
                  {p.name}{" "}
                  <span className="text-xs font-normal text-muted-foreground">{roleLabel(p.role as Parameters<typeof roleLabel>[0])}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {p.branch_name ?? "지점 미지정"} · {formatDate(p.created_at)} 신청
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  className="gap-1"
                  disabled={busyId === p.id}
                  onClick={() => mutation.mutate({ id: p.id, action: "approve" })}
                >
                  <Check className="size-4" /> 승인
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  disabled={busyId === p.id}
                  onClick={() => mutation.mutate({ id: p.id, action: "reject" })}
                >
                  <X className="size-4" /> 거절
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

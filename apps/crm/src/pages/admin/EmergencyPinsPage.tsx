import { useState } from "react";
import { errorMessage } from "@/lib/errors";
import { LoadingState, EmptyState, ErrorState } from "@/components/ui/states";
import { Navigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, Ban } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirmDialog";
import { useAuth } from "@/contexts/AuthContext";
import {
  listEmergencyPins,
  revokeEmergencyPin,
} from "@/services/emergencyPins";
import { IssueEmergencyPinDialog } from "@/components/admin/IssueEmergencyPinDialog";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import {
  EMERGENCY_PIN_STATUS_LABELS,
  type EmergencyPinStatus,
} from "@153/shared";

const ALLOWED_ROLES = new Set([
  "super_admin",
  "hq_admin",
  "branch_owner",
  "branch_manager",
]);

const STATUS_STYLES: Record<EmergencyPinStatus, string> = {
  active: "bg-green-100 text-green-800",
  used: "bg-gray-200 text-gray-700",
  expired: "bg-gray-200 text-gray-700",
  revoked: "bg-red-100 text-red-700",
};

export default function EmergencyPinsPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [openIssue, setOpenIssue] = useState(false);
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["emergency-pins"],
    queryFn: listEmergencyPins,
    staleTime: 10_000,
  });

  const revokeMutation = useMutation({
    mutationFn: revokeEmergencyPin,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["emergency-pins"] });
      setActionMsg("PIN 이 취소됐습니다.");
      setRevokeId(null);
    },
    onError: (err) => {
      setActionMsg(`취소 실패: ${errorMessage(err)}`);
      setRevokeId(null);
    },
  });

  if (profile && !ALLOWED_ROLES.has(profile.role)) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="비상 PIN"
        description="단말기 장애·본인확인 불가 시 발급. 발급된 PIN 은 1회만 노출되며, 단말기에서 credential_type=pin 으로 검증됩니다."
        action={
          <Button onClick={() => setOpenIssue(true)} className="gap-2 rounded-full">
            <Plus className="size-4" />
            PIN 발급
          </Button>
        }
      />

      {actionMsg && (
        <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary shadow-card">{actionMsg}</div>
      )}

      <Card className="overflow-hidden rounded-2xl">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">상태</th>
              <th className="px-4 py-3">지점</th>
              <th className="px-4 py-3">사유</th>
              <th className="px-4 py-3">발급자</th>
              <th className="px-4 py-3">발급</th>
              <th className="px-4 py-3">만료</th>
              <th className="px-4 py-3">사용</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={8}><LoadingState /></td></tr>
            )}
            {isError && (
              <tr><td colSpan={8}><ErrorState error={error} /></td></tr>
            )}
            {!isLoading && !isError && (data?.length ?? 0) === 0 && (
              <tr><td colSpan={8}><EmptyState icon={KeyRound} title="발급 이력이 없습니다" /></td></tr>
            )}
            {(data ?? []).map((p) => (
              <tr key={p.id} className="border-b border-border/60 transition-colors hover:bg-muted/40">
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                      STATUS_STYLES[p.status]
                    )}
                  >
                    {EMERGENCY_PIN_STATUS_LABELS[p.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{p.branch_name ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{p.purpose ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{p.issuer_name ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatDateTime(p.issued_at)}</td>
                <td className="px-4 py-3 text-muted-foreground">{formatDateTime(p.expires_at)}</td>
                <td className="px-4 py-3">
                  {p.used_count} / {p.max_uses}
                </td>
                <td className="px-4 py-3 text-right">
                  {p.status === "active" && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        setActionMsg(null);
                        setRevokeId(p.id);
                      }}
                    >
                      <Ban className="size-3" />
                      취소
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Card>

      <IssueEmergencyPinDialog open={openIssue} onClose={() => setOpenIssue(false)} />

      <ConfirmDialog
        open={!!revokeId}
        onClose={() => {
          if (!revokeMutation.isPending) setRevokeId(null);
        }}
        title="PIN 취소"
        description={
          <span className="flex gap-2">
            <KeyRound className="size-4 shrink-0 mt-0.5 text-muted-foreground/60" />
            <span>PIN 을 즉시 무효화합니다. 발급 후 사용 전이라면 사용 불가가 됩니다.</span>
          </span>
        }
        confirmLabel="취소"
        variant="destructive"
        onConfirm={() => revokeId && revokeMutation.mutate(revokeId)}
        pending={revokeMutation.isPending}
      />
    </div>
  );
}

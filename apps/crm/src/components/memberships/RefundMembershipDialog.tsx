import { type FormEvent, useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Receipt, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog } from "@/components/ui/dialog";
import { refundMembership } from "@/services/memberships";
import type { Membership } from "@153/shared";

interface Props {
  open: boolean;
  onClose: () => void;
  membership: Membership;
  memberId: string;
}

function formatPrice(n: number) {
  return n.toLocaleString("ko-KR") + "원";
}

export function RefundMembershipDialog({ open, onClose, membership, memberId }: Props) {
  const qc = useQueryClient();
  const [refundAmount, setRefundAmount] = useState<string>("");
  const [refundReason, setRefundReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      // 기존 가격이 있으면 기본값으로 설정
      setRefundAmount(membership.price ? String(membership.price) : "");
      setRefundReason("");
      setConfirmed(false);
      setError(null);
    }
  }, [open, membership.price]);

  const mutation = useMutation({
    mutationFn: () =>
      refundMembership({
        membership_id: membership.id,
        refund_amount: refundAmount ? Number(refundAmount) : undefined,
        refund_reason: refundReason || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["member-related", memberId] });
      void qc.invalidateQueries({ queryKey: ["memberships"] });
      void qc.invalidateQueries({ queryKey: ["access-preview", memberId] });
      onClose();
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "환불 처리 실패";
      setError(
        msg.includes("ALREADY_REFUNDED") ? "이미 환불 처리된 이용권입니다."
        : msg.includes("MEMBERSHIP_NOT_FOUND") ? "이용권을 찾을 수 없습니다."
        : msg
      );
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!confirmed) {
      setError("환불 처리에 동의해주세요.");
      return;
    }
    setError(null);
    mutation.mutate();
  }

  const parsedAmount = refundAmount ? Number(refundAmount) : null;
  const originalPrice = membership.price ?? null;

  return (
    <Dialog open={open} onClose={onClose} title="이용권 환불">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
        {/* 대상 이용권 */}
        <div className="rounded-lg bg-danger/10 border border-danger/30 px-4 py-3 flex items-start gap-3">
          <Receipt className="size-4 text-danger mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">{membership.plan_name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {membership.start_date} ~ {membership.end_date}
            </p>
            {originalPrice != null && (
              <p className="text-xs text-muted-foreground">
                결제 금액: <span className="font-semibold text-foreground">{formatPrice(originalPrice)}</span>
              </p>
            )}
          </div>
        </div>

        {/* 환불 금액 */}
        <div className="space-y-1.5">
          <Label htmlFor="refund-amount">
            환불 금액
            <span className="ml-1 text-xs text-muted-foreground font-normal">(선택 — 미입력 시 미기재)</span>
          </Label>
          <div className="relative">
            <Input
              id="refund-amount"
              type="number"
              min={0}
              step={1000}
              placeholder={originalPrice != null ? String(originalPrice) : "0"}
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
              className="pr-8"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">원</span>
          </div>
          {parsedAmount != null && parsedAmount > 0 && (
            <p className="text-xs text-primary font-medium">{formatPrice(parsedAmount)}</p>
          )}
          {originalPrice != null && parsedAmount != null && parsedAmount < originalPrice && parsedAmount >= 0 && (
            <p className="text-xs text-warning">
              부분 환불: {formatPrice(originalPrice - parsedAmount)} 차감
            </p>
          )}
        </div>

        {/* 환불 사유 */}
        <div className="space-y-1.5">
          <Label htmlFor="refund-reason">
            환불 사유
            <span className="ml-1 text-xs text-muted-foreground font-normal">(선택)</span>
          </Label>
          <Input
            id="refund-reason"
            placeholder="예: 부상, 이사, 불만족…"
            value={refundReason}
            onChange={(e) => setRefundReason(e.target.value)}
            maxLength={200}
          />
        </div>

        {/* 경고 및 확인 체크 */}
        <div className="rounded-lg bg-muted/60 border border-border px-4 py-3 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="size-4 text-warning mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              환불 처리 시 이용권은 <strong className="text-foreground">즉시 취소</strong>되며, 해당 회원의
              출입 권한이 제거됩니다. 이 작업은 <strong className="text-foreground">되돌릴 수 없습니다.</strong>
            </p>
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="size-4 rounded accent-danger"
            />
            <span className="text-sm text-foreground">
              위 내용을 확인했으며, 환불 처리에 동의합니다.
            </span>
          </label>
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
            disabled={mutation.isPending || !confirmed}
            className="gap-2 bg-danger text-danger-foreground hover:bg-danger/90"
          >
            {mutation.isPending ? (
              <><span className="size-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> 처리 중…</>
            ) : (
              <><Receipt className="size-4" /> 환불 처리</>
            )}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

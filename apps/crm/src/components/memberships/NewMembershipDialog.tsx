import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { createMembership } from "@/services/memberships";
import { cn } from "@/lib/cn";
import type { Member, PaymentStatus } from "@153/shared";

interface Props {
  open: boolean;
  onClose: () => void;
  member: Member;
}

interface PlanPreset {
  name: string;
  days: number;
  price: number;
  tag?: string;
}

const PRESETS: PlanPreset[] = [
  { name: "월간권", days: 30,  price: 150_000 },
  { name: "분기권", days: 90,  price: 400_000, tag: "인기" },
  { name: "반기권", days: 180, price: 720_000 },
  { name: "연간권", days: 365, price: 1_300_000, tag: "Best" },
];

function todayIso() { return new Date().toISOString().slice(0, 10); }
function addDays(iso: string, days: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function formatPrice(n: number) {
  return n.toLocaleString("ko-KR") + "원";
}

const PAYMENT_OPTIONS: { value: PaymentStatus; label: string; color: string }[] = [
  { value: "paid",    label: "결제완료", color: "border-success bg-success/10 text-success" },
  { value: "partial", label: "부분결제", color: "border-warning bg-warning/10 text-warning" },
  { value: "unpaid",  label: "미납",     color: "border-danger bg-danger/10 text-danger" },
];

export function NewMembershipDialog({ open, onClose, member }: Props) {
  const qc = useQueryClient();
  const [selectedPreset, setSelectedPreset] = useState(0);
  const [customName, setCustomName] = useState("");
  const [days, setDays] = useState(PRESETS[0]?.days ?? 30);
  const [price, setPrice] = useState(PRESETS[0]?.price ?? 0);
  const [startDate, setStartDate] = useState(todayIso());
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("paid");
  const [isCustom, setIsCustom] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endDate = useMemo(() => addDays(startDate, days), [startDate, days]);
  const planName = isCustom ? customName : (PRESETS[selectedPreset]?.name ?? "");

  useEffect(() => {
    if (!open) return;
    setSelectedPreset(0);
    setCustomName("");
    setDays(PRESETS[0]?.days ?? 30);
    setPrice(PRESETS[0]?.price ?? 0);
    setStartDate(todayIso());
    setPaymentStatus("paid");
    setIsCustom(false);
    setError(null);
  }, [open]);

  const mutation = useMutation({
    mutationFn: createMembership,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["memberships"] });
      void qc.invalidateQueries({ queryKey: ["member-related", member.id] });
      void qc.invalidateQueries({ queryKey: ["access-preview", member.id] });
      void qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "등록 실패"),
  });

  function handlePresetSelect(idx: number) {
    setSelectedPreset(idx);
    setIsCustom(false);
    setDays(PRESETS[idx]?.days ?? 30);
    setPrice(PRESETS[idx]?.price ?? 0);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!planName.trim()) { setError("플랜 이름을 입력하세요"); return; }
    if (days < 1) { setError("기간은 1일 이상이어야 합니다"); return; }
    mutation.mutate({
      member_id: member.id,
      branch_id: member.branch_id,
      plan_name: planName.trim(),
      start_date: startDate,
      end_date: endDate,
      payment_status: paymentStatus,
      price: price > 0 ? price : null,
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title={`이용권 등록`}>
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* 회원 정보 표시 */}
        <div className="flex items-center gap-2.5 rounded-lg bg-muted/60 px-3 py-2.5">
          <div className="flex size-7 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
            {member.name[0]}
          </div>
          <span className="text-sm font-semibold text-foreground">{member.name}</span>
          <span className="text-xs text-muted-foreground">이용권 신규 등록</span>
        </div>

        {/* 플랜 카드 선택 */}
        <div>
          <Label className="mb-2 block">플랜 선택</Label>
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map((p, idx) => (
              <button
                key={p.name}
                type="button"
                onClick={() => handlePresetSelect(idx)}
                className={cn(
                  "relative flex flex-col items-start gap-0.5 rounded-xl border p-3 text-left transition-all",
                  !isCustom && selectedPreset === idx
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-border bg-card hover:border-primary/40"
                )}
              >
                {p.tag && (
                  <span className="absolute right-2 top-2 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                    {p.tag}
                  </span>
                )}
                <span className="text-sm font-semibold text-foreground">{p.name}</span>
                <span className="text-xs text-muted-foreground">{p.days}일</span>
                <span className="mt-1 text-sm font-bold text-primary">{formatPrice(p.price)}</span>
              </button>
            ))}
          </div>

          {/* 직접 입력 */}
          <button
            type="button"
            onClick={() => setIsCustom(true)}
            className={cn(
              "mt-2 w-full rounded-xl border px-3 py-2.5 text-left text-sm transition-all",
              isCustom
                ? "border-primary bg-primary/5"
                : "border-dashed border-border text-muted-foreground hover:border-primary/40"
            )}
          >
            {isCustom ? (
              <Input
                autoFocus
                placeholder="플랜 이름 직접 입력"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="border-0 p-0 h-auto bg-transparent focus:ring-0 text-sm"
              />
            ) : (
              "+ 직접 입력"
            )}
          </button>
        </div>

        {/* 기간 설정 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="start">시작일</Label>
            <Input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="days">기간 (일)</Label>
            <Input
              id="days"
              type="number"
              min={1}
              max={730}
              value={days}
              onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) setDays(v); }}
              required
            />
          </div>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-sm">
          <span className="text-muted-foreground">종료일</span>
          <span className="font-semibold text-foreground tabular">{endDate}</span>
        </div>

        {/* 가격 */}
        <div className="space-y-1.5">
          <Label htmlFor="price">가격 (원)</Label>
          <div className="relative">
            <Input
              id="price"
              type="number"
              min={0}
              step={10000}
              value={price}
              onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) setPrice(v); }}
              className="pr-14"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">원</span>
          </div>
          {price > 0 && (
            <p className="text-xs text-primary font-medium">{formatPrice(price)}</p>
          )}
        </div>

        {/* 결제 상태 */}
        <div className="space-y-1.5">
          <Label>결제 상태</Label>
          <div className="flex gap-2">
            {PAYMENT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPaymentStatus(opt.value)}
                className={cn(
                  "flex-1 rounded-lg border px-2 py-2 text-xs font-semibold transition-all",
                  paymentStatus === opt.value
                    ? opt.color
                    : "border-border bg-card text-muted-foreground hover:border-primary/40"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2.5">
            <div className="size-1.5 rounded-full bg-danger shrink-0" />
            <p className="text-sm text-danger">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>취소</Button>
          <Button type="submit" disabled={mutation.isPending} className="gap-2 px-6">
            {mutation.isPending ? (
              <>
                <span className="size-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                등록 중…
              </>
            ) : "이용권 등록"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { createMembership } from "@/services/memberships";
import type { Member, PaymentStatus } from "@153/shared";

interface Props {
  open: boolean;
  onClose: () => void;
  member: Member;
}

interface PlanPreset {
  name: string;
  days: number;
}

const PRESETS: PlanPreset[] = [
  { name: "월간권 30일", days: 30 },
  { name: "분기권 90일", days: 90 },
  { name: "반기권 180일", days: 180 },
  { name: "연간권 365일", days: 365 },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function NewMembershipDialog({ open, onClose, member }: Props) {
  const qc = useQueryClient();
  const [planName, setPlanName] = useState(PRESETS[0]?.name ?? "");
  const [days, setDays] = useState(PRESETS[0]?.days ?? 30);
  const [startDate, setStartDate] = useState(todayIso());
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("paid");
  const [error, setError] = useState<string | null>(null);

  const endDate = useMemo(() => addDays(startDate, days), [startDate, days]);

  useEffect(() => {
    if (!open) return;
    setPlanName(PRESETS[0]?.name ?? "");
    setDays(PRESETS[0]?.days ?? 30);
    setStartDate(todayIso());
    setPaymentStatus("paid");
    setError(null);
  }, [open]);

  const mutation = useMutation({
    mutationFn: createMembership,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["memberships"] });
      void qc.invalidateQueries({ queryKey: ["member-related", member.id] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "등록 실패"),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (days < 1) {
      setError("기간은 1일 이상이어야 합니다");
      return;
    }
    mutation.mutate({
      member_id: member.id,
      branch_id: member.branch_id,
      plan_name: planName.trim(),
      start_date: startDate,
      end_date: endDate,
      payment_status: paymentStatus,
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title={`이용권 등록 — ${member.name}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="plan">플랜</Label>
          <Select
            id="plan"
            value={PRESETS.find((p) => p.name === planName) ? planName : ""}
            onChange={(e) => {
              const preset = PRESETS.find((p) => p.name === e.target.value);
              if (preset) {
                setPlanName(preset.name);
                setDays(preset.days);
              }
            }}
          >
            {PRESETS.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="start">시작일</Label>
            <Input
              id="start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="days">기간 (일)</Label>
            <Input
              id="days"
              type="number"
              min={1}
              max={730}
              value={days}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isNaN(v)) setDays(v);
              }}
              required
            />
          </div>
        </div>
        <p className="text-xs opacity-70">종료일: {endDate}</p>
        <div className="space-y-2">
          <Label htmlFor="pay">결제 상태</Label>
          <Select
            id="pay"
            value={paymentStatus}
            onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus)}
          >
            <option value="paid">결제완료</option>
            <option value="partial">부분결제</option>
            <option value="unpaid">미납</option>
          </Select>
        </div>
        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "등록 중…" : "등록"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

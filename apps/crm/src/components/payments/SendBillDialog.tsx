import { type FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sendPaymentBill } from "@/services/payments";
import type { Member, Membership } from "@153/shared";

interface Props {
  open: boolean;
  onClose: () => void;
  member: Member;
  membership?: Membership | null; // 연계 이용권 (선택)
}

export function SendBillDialog({ open, onClose, member, membership }: Props) {
  const qc = useQueryClient();

  const defaultDesc = membership
    ? `${membership.plan_name} 갱신`
    : `회원권 결제`;

  const [amount, setAmount] = useState(
    membership?.price ? String(Math.round(membership.price)) : ""
  );
  const [description, setDescription] = useState(defaultDesc);
  const [dueDate, setDueDate] = useState("");
  const [phone, setPhone] = useState(member.phone ?? "");
  const [sentVia, setSentVia] = useState<"sms" | "kakao" | "both">("sms");
  const [error, setError] = useState<string | null>(null);
  const [billUrl, setBillUrl] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      sendPaymentBill({
        member_id:      member.id,
        membership_id:  membership?.id,
        amount:         Number(amount),
        description,
        due_date:       dueDate || undefined,
        recipient_phone: phone.replace(/-/g, ""),
        sent_via:       sentVia,
      }),
    onSuccess: (data) => {
      setBillUrl(data.bill_url);
      void qc.invalidateQueries({ queryKey: ["payment-requests", member.id] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "발송 실패"),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBillUrl(null);
    mutation.mutate();
  }

  function handleClose() {
    setAmount(membership?.price ? String(Math.round(membership.price)) : "");
    setDescription(defaultDesc);
    setDueDate("");
    setPhone(member.phone ?? "");
    setSentVia("sms");
    setError(null);
    setBillUrl(null);
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-card shadow-2xl border border-border animate-fade-in">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border">
          <div>
            <h2 className="text-base font-bold text-foreground">청구서 발송</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{member.name} 회원</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* 발송 성공 상태 */}
        {billUrl ? (
          <div className="px-6 py-8 flex flex-col items-center gap-4 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-success/10">
              <Send className="size-6 text-success" />
            </div>
            <div>
              <p className="font-semibold text-foreground">청구서가 발송되었습니다</p>
              <p className="text-sm text-muted-foreground mt-1">{member.name} 회원의 휴대폰으로 결제 링크가 전송되었습니다.</p>
            </div>
            <a
              href={billUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-brand underline"
            >
              결제 링크 확인
            </a>
            <Button className="w-full mt-2" onClick={handleClose}>닫기</Button>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="px-6 py-5 space-y-4">
            {/* 금액 */}
            <div className="space-y-1.5">
              <Label htmlFor="bill-amount" className="text-sm font-medium">
                청구 금액 <span className="text-danger">*</span>
              </Label>
              <div className="relative">
                <Input
                  id="bill-amount"
                  type="number"
                  required
                  min={1000}
                  step={1000}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="100000"
                  className="pr-10"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">원</span>
              </div>
            </div>

            {/* 청구 내용 */}
            <div className="space-y-1.5">
              <Label htmlFor="bill-desc" className="text-sm font-medium">
                청구 내용 <span className="text-danger">*</span>
              </Label>
              <Input
                id="bill-desc"
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="2026년 6월 회원권"
                maxLength={100}
              />
            </div>

            {/* 납부 기한 */}
            <div className="space-y-1.5">
              <Label htmlFor="bill-due" className="text-sm font-medium">
                납부 기한 <span className="text-muted-foreground text-xs">(선택)</span>
              </Label>
              <Input
                id="bill-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>

            {/* 수신 번호 */}
            <div className="space-y-1.5">
              <Label htmlFor="bill-phone" className="text-sm font-medium">
                수신 번호 <span className="text-danger">*</span>
              </Label>
              <Input
                id="bill-phone"
                required
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="01012345678"
              />
            </div>

            {/* 발송 방법 */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">발송 방법</Label>
              <div className="flex gap-2">
                {(["sms", "kakao", "both"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setSentVia(v)}
                    className={[
                      "flex-1 rounded-lg border py-2 text-xs font-semibold transition-colors",
                      sentVia === v
                        ? "border-brand bg-brand/5 text-brand"
                        : "border-border text-muted-foreground hover:border-brand/40",
                    ].join(" ")}
                  >
                    {v === "sms" ? "SMS" : v === "kakao" ? "카카오" : "둘 다"}
                  </button>
                ))}
              </div>
            </div>

            {/* 에러 */}
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2.5">
                <div className="size-1.5 shrink-0 rounded-full bg-danger" />
                <p className="text-sm text-danger">{error}</p>
              </div>
            )}

            {/* 버튼 */}
            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={handleClose}>
                취소
              </Button>
              <Button type="submit" disabled={mutation.isPending} className="flex-1 gap-1.5">
                {mutation.isPending ? (
                  <><span className="size-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" /> 발송 중…</>
                ) : (
                  <><Send className="size-3.5" /> 청구서 발송</>
                )}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * 청구서 발송 (결제선생 / Payssam).
 * - Cloud Run /api/invoices/create 호출
 * - wallet 차감 + 실패 시 환불 자동
 */
import { useEffect, useState } from "react";
import { useBranch } from "@/contexts/BranchContext";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createInvoice,
  getWallet,
  listActivePrices,
  type ServiceWallet,
  type UsagePrice,
} from "@/services/billing";

function fmtKrw(n: number): string {
  return new Intl.NumberFormat("ko-KR").format(n) + "원";
}
function randomKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function InvoiceSendPage() {
  const { tenantId, currentBranchId } = useBranch();

  const [wallet, setWallet] = useState<ServiceWallet | null>(null);
  const [prices, setPrices] = useState<UsagePrice[]>([]);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [itemName, setItemName] = useState("");
  const [amountKrw, setAmountKrw] = useState("");
  const [memo, setMemo] = useState("");

  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<
    | { ok: true; invoiceId: string; paymentUrl?: string; balance: number; charged: number }
    | { ok: false; msg: string }
    | null
  >(null);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        const [w, p] = await Promise.all([getWallet(tenantId), listActivePrices()]);
        if (cancelled) return;
        setWallet(w);
        setPrices(p);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const invoicePrice = prices.find((p) => p.usage_type === "payssam_invoice")?.charge_krw ?? 0;
  const balance = wallet?.balance_krw ?? 0;
  const insufficient = balance < invoicePrice;

  const parsedAmount = Number(amountKrw.replace(/[^0-9]/g, ""));
  const canSend =
    !!tenantId &&
    !!customerPhone.trim() &&
    !!itemName.trim() &&
    parsedAmount > 0 &&
    !insufficient &&
    !sending;

  async function onSend() {
    if (!tenantId || !canSend) return;
    setSending(true);
    setResult(null);
    try {
      const r = await createInvoice({
        tenant_id: tenantId,
        branch_id: currentBranchId ?? undefined,
        amount_krw: parsedAmount,
        customer_name: customerName.trim() || undefined,
        customer_phone: customerPhone.trim(),
        item_name: itemName.trim(),
        memo: memo.trim() || undefined,
        idempotency_key: `inv-${tenantId}-${randomKey()}`,
      });
      setResult({
        ok: true,
        invoiceId: r.invoice_id,
        paymentUrl: r.payment_url,
        balance: r.balance_after_krw,
        charged: r.charged_krw,
      });
      // 잔액 갱신
      const w = await getWallet(tenantId);
      setWallet(w);
      // 양식 초기화 (회수 가능 정보는 일부 유지)
      setAmountKrw("");
      setItemName("");
      setMemo("");
    } catch (e) {
      const err = e as Error & { code?: string };
      setResult({
        ok: false,
        msg:
          err.code === "INSUFFICIENT_BALANCE"
            ? "잔액 부족 — 운영 크레딧 충전 후 다시 시도하세요"
            : err.message || "발송 실패",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="청구서 발송" description="결제선생 결제 링크 발행 — 1건당 운영 크레딧 차감" />

      <Card className="p-4 flex items-center justify-between text-sm">
        <div>
          <span className="text-slate-500">현재 잔액 </span>
          <span className="font-semibold tabular-nums">{fmtKrw(balance)}</span>
        </div>
        <Badge tone={insufficient ? "danger" : "success"}>
          {insufficient ? "잔액 부족" : `예상 차감 ${fmtKrw(invoicePrice)}`}
        </Badge>
      </Card>

      <Card className="p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="cust-name">고객 이름 (선택)</Label>
            <Input id="cust-name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cust-phone">고객 휴대전화</Label>
            <Input
              id="cust-phone"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="010-1234-5678"
              inputMode="tel"
            />
          </div>
          <div>
            <Label htmlFor="item">상품/항목</Label>
            <Input
              id="item"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="예: 1개월 회원권"
            />
          </div>
          <div>
            <Label htmlFor="amt">금액 (원)</Label>
            <Input
              id="amt"
              value={amountKrw}
              onChange={(e) => setAmountKrw(e.target.value)}
              placeholder="100000"
              inputMode="numeric"
            />
            {parsedAmount > 0 && (
              <p className="mt-1 text-[11px] text-slate-500">{fmtKrw(parsedAmount)}</p>
            )}
          </div>
        </div>
        <div>
          <Label htmlFor="memo">메모 (선택)</Label>
          <textarea
            id="memo"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={2}
            className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
          />
        </div>

        {result && (
          <div
            className={`rounded-md px-3 py-2 text-sm ${
              result.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
            }`}
          >
            {result.ok ? (
              <>
                <div className="font-semibold">청구서 발행 성공</div>
                <div className="mt-1">
                  잔액 {fmtKrw(result.balance)} (차감 {fmtKrw(result.charged)})
                </div>
                {result.paymentUrl && (
                  <div className="mt-1">
                    결제 링크:{" "}
                    <a className="underline" href={result.paymentUrl} target="_blank" rel="noreferrer">
                      {result.paymentUrl}
                    </a>
                  </div>
                )}
              </>
            ) : (
              result.msg
            )}
          </div>
        )}

        <div className="flex justify-end pt-1">
          <Button onClick={onSend} disabled={!canSend}>
            {sending ? "발송중…" : "청구서 발송"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

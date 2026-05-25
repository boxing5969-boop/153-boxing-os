/**
 * 문자 발송 페이지 (B2B SaaS — wallet 차감 방식).
 * - Cloud Run /api/messages/send 호출 (Aligo 직접 호출 금지)
 * - 발송 전 잔액·예상 차감액 표시
 * - marketing 카테고리 → 동의/거부 안내 + 자동 광고 prefix 안내
 */
import { useEffect, useMemo, useState } from "react";
import { useBranch } from "@/contexts/BranchContext";
import PageHeader from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getWallet,
  listActivePrices,
  listRecentMessageLogs,
  listSenders,
  sendMessage,
  type MessageSender,
  type RecentMessageLog,
  type ServiceWallet,
  type UsagePrice,
} from "@/services/billing";

function fmtKrw(n: number): string {
  return new Intl.NumberFormat("ko-KR").format(n) + "원";
}
function fmtDate(s: string): string {
  return new Date(s).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

function calcKrBytes(text: string): number {
  let n = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    n += code > 127 ? 2 : 1;
  }
  return n;
}

function randomKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function B2BMessageSendPage() {
  const { tenantId, currentBranchId } = useBranch();

  const [wallet, setWallet] = useState<ServiceWallet | null>(null);
  const [prices, setPrices] = useState<UsagePrice[]>([]);
  const [senders, setSenders] = useState<MessageSender[]>([]);
  const [recentLogs, setRecentLogs] = useState<RecentMessageLog[]>([]);

  const [recipient, setRecipient] = useState("");
  const [senderId, setSenderId] = useState<string>("");
  const [category, setCategory] = useState<"informational" | "marketing">("informational");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        const [w, p, s, l] = await Promise.all([
          getWallet(tenantId),
          listActivePrices(),
          listSenders(tenantId),
          listRecentMessageLogs(tenantId, 10),
        ]);
        if (cancelled) return;
        setWallet(w);
        setPrices(p);
        setSenders(s);
        setRecentLogs(l);
        // 기본 sender = approved 중 첫 번째
        const firstApproved = s.find((x) => x.status === "approved");
        if (firstApproved) setSenderId(firstApproved.id);
      } catch {
        /* ignore — error 는 send 시 표시 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const bytes = calcKrBytes(content);
  const messageType: "sms" | "lms" | "mms" = bytes > 90 ? "lms" : "sms";
  const priceMap = useMemo(() => {
    const m = new Map<string, number>();
    prices.forEach((p) => m.set(p.usage_type, p.charge_krw));
    return m;
  }, [prices]);
  const estCharge = priceMap.get(messageType) ?? 0;
  const balance = wallet?.balance_krw ?? 0;
  const insufficient = balance < estCharge;

  const canSend =
    !!tenantId &&
    !!recipient.trim() &&
    !!content.trim() &&
    !!senderId &&
    !insufficient &&
    !sending;

  async function onSend() {
    if (!tenantId || !canSend) return;
    setSending(true);
    setResult(null);
    try {
      const r = await sendMessage({
        tenant_id: tenantId,
        branch_id: currentBranchId ?? undefined,
        sender_id: senderId,
        recipient_phone: recipient.trim(),
        message_type: messageType,
        category,
        content: content.trim(),
        idempotency_key: `msg-${tenantId}-${randomKey()}`,
      });
      setResult({
        ok: r.ok,
        msg: r.ok
          ? `발송 성공 — ${fmtKrw(r.charged_krw)} 차감 (잔액 ${fmtKrw(r.balance_after_krw)})`
          : `발송 실패 — ${r.message ?? "알 수 없는 오류"} (환불 처리됨)`,
      });
      if (r.ok) {
        setContent("");
        // 최신 잔액·로그 갱신
        const [w, l] = await Promise.all([getWallet(tenantId), listRecentMessageLogs(tenantId, 10)]);
        setWallet(w);
        setRecentLogs(l);
      }
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
      <PageHeader title="문자 발송" description="SMS/LMS — 발송 시 운영 크레딧에서 자동 차감" />

      <Card className="p-4 flex items-center justify-between text-sm">
        <div>
          <span className="text-slate-500">현재 잔액 </span>
          <span className="font-semibold tabular-nums">{fmtKrw(balance)}</span>
        </div>
        <Badge tone={insufficient ? "danger" : "success"}>
          {insufficient ? "잔액 부족" : `예상 차감 ${fmtKrw(estCharge)}`}
        </Badge>
      </Card>

      <Card className="p-5 space-y-4">
        <div>
          <Label htmlFor="recipient">수신 번호</Label>
          <Input
            id="recipient"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="010-1234-5678"
            inputMode="tel"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="sender">발신 번호</Label>
            <select
              id="sender"
              value={senderId}
              onChange={(e) => setSenderId(e.target.value)}
              className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
            >
              <option value="">선택 안함</option>
              {senders.map((s) => (
                <option key={s.id} value={s.id} disabled={s.status !== "approved"}>
                  {s.sender_number} {s.status !== "approved" ? `(${s.status})` : ""}
                </option>
              ))}
            </select>
            {senders.length === 0 && (
              <p className="text-[11px] text-amber-600 mt-1">
                등록된 발신번호가 없습니다. "통합 설정" 에서 등록·승인 필요.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="category">유형</Label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value as "informational" | "marketing")}
              className="mt-1 w-full border rounded-md px-3 py-2 text-sm"
            >
              <option value="informational">정보성 문자</option>
              <option value="marketing">광고성 문자</option>
            </select>
          </div>
        </div>

        <div>
          <Label htmlFor="content">본문</Label>
          <textarea
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={5}
            placeholder="안녕하세요 …"
            className="mt-1 w-full border rounded-md px-3 py-2 text-sm resize-y"
          />
          <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
            <Badge tone="neutral">{messageType.toUpperCase()}</Badge>
            <span>{bytes} bytes</span>
            <span className="text-slate-300">·</span>
            <span>예상 차감 {fmtKrw(estCharge)}</span>
          </div>
        </div>

        {category === "marketing" && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 space-y-1">
            <div>
              <strong>광고성 문자 주의:</strong> 수신 동의(`수신동의=true`)가 등록된 번호로만 발송됩니다.
            </div>
            <div>본문에 <code className="bg-white px-1 rounded">(광고)</code> prefix 와 무료수신거부 번호가 자동 추가됩니다.</div>
            <div>수신거부 명단에 등록된 번호는 차단됩니다.</div>
          </div>
        )}

        {result && (
          <div
            className={`rounded-md px-3 py-2 text-sm ${
              result.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
            }`}
          >
            {result.msg}
          </div>
        )}

        <div className="flex justify-end pt-1">
          <Button onClick={onSend} disabled={!canSend}>
            {sending ? "발송중…" : "발송"}
          </Button>
        </div>
      </Card>

      {/* 최근 발송 로그 */}
      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="text-sm font-semibold">최근 발송</h2>
        </div>
        {recentLogs.length === 0 ? (
          <div className="p-5 text-sm text-slate-400">발송 이력이 없습니다.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {recentLogs.map((l) => (
              <div key={l.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <Badge tone={l.status === "sent" ? "success" : l.status === "failed" ? "danger" : "neutral"}>
                  {l.status === "sent" ? "발송됨" : l.status === "failed" ? "발송 실패" : l.status ?? "—"}
                </Badge>
                <div className="flex-1 min-w-0">
                  <div className="truncate">
                    {l.recipient_phone ?? "—"}{" "}
                    <span className="text-slate-400">· {l.message_type?.toUpperCase()}</span>
                  </div>
                  <div className="text-[11px] text-slate-400">{fmtDate(l.created_at)}</div>
                </div>
                {l.error_message && (
                  <div className="text-[11px] text-rose-600 max-w-[40%] truncate">{l.error_message}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

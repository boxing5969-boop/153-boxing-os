import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle, XCircle, MessageSquare, Phone, Layers } from "lucide-react";
import { listMessageSendLogs, type MessageSendLog } from "@/services/messaging";
import { useAuth } from "@/contexts/AuthContext";
import { LoadingState, EmptyState } from "@/components/ui/states";
import { cn } from "@/lib/cn";

// ── 채널 레이블 ─────────────────────────────────────────────
const CHANNEL_LABEL: Record<string, string> = {
  sms:   "SMS",
  kakao: "카카오",
};
const CHANNEL_COLOR: Record<string, string> = {
  sms:   "bg-blue-50 text-blue-700",
  kakao: "bg-yellow-50 text-yellow-700",
};
const CHANNEL_ICON: Record<string, ReactNode> = {
  sms:   <Phone className="size-3" />,
  kakao: <MessageSquare className="size-3" />,
};

// ── 트리거 유형 한글 ────────────────────────────────────────
const TRIGGER_LABELS: Record<string, string> = {
  expiry_d7:  "D-7",
  expiry_d3:  "D-3",
  expiry_d1:  "D-1",
  expiry_d0:  "D-0",
  expiry_dp7: "D+7",
  manual:     "수동",
  bulk:       "그룹",
  scheduled:  "예약",
};

type StatusFilter = "all" | "sent" | "failed";

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function maskPhone(phone: string | null) {
  if (!phone) return "-";
  const p = phone.replace(/\D/g, "");
  if (p.length === 11) return `${p.slice(0,3)}-${p.slice(3,7).replace(/\d/g,"*")}-${p.slice(7)}`;
  return phone;
}

export default function MessageSendLogsPage() {
  const { profile } = useAuth();
  const branchId = profile?.branch_id;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["msg-send-logs", branchId, statusFilter],
    queryFn: () => listMessageSendLogs({ branchId: branchId ?? undefined, limit: 300 }),
    staleTime: 30_000,
  });

  const filtered = statusFilter === "all" ? logs : logs.filter(l => l.status === statusFilter);

  const totalSent   = logs.filter(l => l.status === "sent").length;
  const totalFailed = logs.filter(l => l.status === "failed").length;

  const filterTabs: { key: StatusFilter; label: string }[] = [
    { key: "all",    label: `전체 (${logs.length})` },
    { key: "sent",   label: `성공 (${totalSent})` },
    { key: "failed", label: `실패 (${totalFailed})` },
  ];

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-black text-foreground">통합 발송 이력</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          SMS · 카카오 알림톡 발송 기록을 모두 확인합니다.
        </p>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
          <p className="text-xs text-muted-foreground">전체 발송</p>
          <p className="mt-1 text-2xl font-black tabular">{logs.length}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
          <p className="text-xs text-muted-foreground">성공</p>
          <p className="mt-1 text-2xl font-black text-success tabular">{totalSent}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
          <p className="text-xs text-muted-foreground">실패</p>
          <p className={cn("mt-1 text-2xl font-black tabular", totalFailed > 0 ? "text-danger" : "text-foreground")}>
            {totalFailed}
          </p>
        </div>
      </div>

      {/* 테이블 */}
      <div className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
        {/* 탭 */}
        <div className="flex gap-1 border-b border-border px-4 pt-3">
          {filterTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-t-md transition-colors",
                statusFilter === tab.key
                  ? "bg-background border border-b-background border-border text-foreground -mb-px"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <LoadingState />
        ) : filtered.length === 0 ? (
          <EmptyState icon={MessageSquare} title="발송 이력이 없습니다" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">발송 시각</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">회원명</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">채널</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">수신 번호</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">트리거</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">내용 미리보기</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">결과</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">오류</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((log: MessageSendLog) => (
                  <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 tabular text-xs text-muted-foreground whitespace-nowrap">
                      {formatDateTime(log.sent_at)}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">
                      {log.member_name ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                        CHANNEL_COLOR[log.channel] ?? "bg-muted text-muted-foreground"
                      )}>
                        {CHANNEL_ICON[log.channel]}
                        {CHANNEL_LABEL[log.channel] ?? log.channel}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular text-xs text-muted-foreground whitespace-nowrap">
                      {maskPhone(log.recipient_phone)}
                    </td>
                    <td className="px-4 py-3">
                      {log.trigger_type ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          <Layers className="size-2.5" />
                          {TRIGGER_LABELS[log.trigger_type] ?? log.trigger_type}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-xs truncate">
                      {log.content_preview ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {log.status === "sent" ? (
                        <span className="inline-flex items-center gap-1 text-success text-xs font-medium">
                          <CheckCircle className="size-3.5" />성공
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-danger text-xs font-medium">
                          <XCircle className="size-3.5" />실패
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-xs truncate">
                      {log.error_message ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

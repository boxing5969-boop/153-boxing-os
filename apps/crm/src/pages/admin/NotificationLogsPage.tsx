import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle, XCircle, Clock, MessageCircle } from "lucide-react";
import { getNotificationLogs } from "@/services/notificationLogs";
import { cn } from "@/lib/cn";

// 알림 유형 한글 레이블
const TYPE_LABELS: Record<string, string> = {
  expiry_d7: "만료 7일 전",
  expiry_d3: "만료 3일 전",
  expiry_d1: "만료 1일 전",
};

const TYPE_COLORS: Record<string, string> = {
  expiry_d7: "bg-muted text-muted-foreground",
  expiry_d3: "bg-warning/10 text-warning",
  expiry_d1: "bg-danger/10 text-danger",
};

type StatusFilter = "all" | "sent" | "failed";

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yy}-${mm}-${dd} ${hh}:${mi}`;
}

function maskPhone(phone: string | null): string {
  if (!phone) return "-";
  const p = phone.replace(/\D/g, "");
  if (p.length === 11) return `${p.slice(0, 3)}-${p.slice(3, 7).replace(/\d/g, "*")}-${p.slice(7)}`;
  return phone;
}

export default function NotificationLogsPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["notification-logs", statusFilter],
    queryFn: () => getNotificationLogs({ status: statusFilter, limit: 200 }),
    staleTime: 30_000,
  });

  const logs = data ?? [];

  // 요약 집계 (전체 쿼리 기준)
  const { data: allData } = useQuery({
    queryKey: ["notification-logs", "all"],
    queryFn: () => getNotificationLogs({ status: "all", limit: 200 }),
    staleTime: 30_000,
  });
  const totalSent   = (allData ?? []).filter(l => l.status === "sent").length;
  const totalFailed = (allData ?? []).filter(l => l.status === "failed").length;

  const filterTabs: { key: StatusFilter; label: string }[] = [
    { key: "all",    label: "전체" },
    { key: "sent",   label: "발송 성공" },
    { key: "failed", label: "발송 실패" },
  ];

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-black text-foreground">알림 발송 이력</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          카카오 알림톡 자동 발송 기록 (매일 00:05 KST 실행)
        </p>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-border bg-card p-4 shadow-card">
          <p className="text-xs text-muted-foreground">전체 발송 시도</p>
          <p className="mt-1 text-2xl font-black text-foreground tabular">
            {(allData ?? []).length}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-card">
          <p className="text-xs text-muted-foreground">성공</p>
          <p className="mt-1 text-2xl font-black text-success tabular">{totalSent}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-card">
          <p className="text-xs text-muted-foreground">실패</p>
          <p className={cn("mt-1 text-2xl font-black tabular", totalFailed > 0 ? "text-danger" : "text-foreground")}>
            {totalFailed}
          </p>
        </div>
      </div>

      {/* 필터 탭 + 테이블 */}
      <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
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

        {/* 테이블 */}
        {isLoading ? (
          <div className="flex items-center justify-center p-12 text-sm opacity-50">
            불러오는 중…
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 p-12 text-muted-foreground">
            <MessageCircle className="size-8 opacity-30" />
            <p className="text-sm">발송 이력이 없습니다.</p>
            {statusFilter !== "all" && (
              <p className="text-xs opacity-70">다른 필터를 선택해보세요.</p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">발송 시각</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">회원명</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">지점</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">알림 유형</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">수신 번호</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">결과</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">오류</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.map(log => (
                  <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 tabular text-xs text-muted-foreground whitespace-nowrap">
                      {formatDateTime(log.sent_at)}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {log.member_name ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {log.branch_name ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                        TYPE_COLORS[log.notification_type] ?? "bg-muted text-muted-foreground"
                      )}>
                        <Clock className="mr-1 size-3" />
                        {TYPE_LABELS[log.notification_type] ?? log.notification_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular text-xs text-muted-foreground">
                      {maskPhone(log.recipient_phone)}
                    </td>
                    <td className="px-4 py-3">
                      {log.status === "sent" ? (
                        <span className="inline-flex items-center gap-1 text-success text-xs font-medium">
                          <CheckCircle className="size-3.5" />
                          성공
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-danger text-xs font-medium">
                          <XCircle className="size-3.5" />
                          실패
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-xs truncate">
                      {log.error_message ?? "-"}
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

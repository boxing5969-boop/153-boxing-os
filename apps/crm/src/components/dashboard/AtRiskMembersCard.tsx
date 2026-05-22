/**
 * 이탈 위험 회원 카드
 * - 미납(unpaid) / 만료 후 미재등록(expired) / 14일 이상 미출석(absent)
 */
import { useQuery } from "@tanstack/react-query";
import { UserX, AlertCircle, Clock3, Wifi } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { getAtRiskMembers, type AtRiskType } from "@/services/dashboardWidgets";
import { cn } from "@/lib/cn";

const RISK_META: Record<AtRiskType, { label: string; color: string; icon: typeof AlertCircle }> = {
  unpaid:  { label: "미납",   color: "text-danger  bg-danger/10",  icon: AlertCircle },
  expired: { label: "만료",   color: "text-warning bg-warning/10", icon: Clock3 },
  absent:  { label: "미출석", color: "text-blue-500 bg-blue-50",   icon: Wifi },
};

function daysSince(dateStr: string): number {
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export function AtRiskMembersCard() {
  const { profile } = useAuth();
  const branchId = profile?.branch_id;

  const { data, isLoading } = useQuery({
    queryKey: ["at-risk-members", branchId],
    queryFn: () => getAtRiskMembers(branchId!),
    enabled: !!branchId,
    staleTime: 5 * 60_000,
  });

  const members = data ?? [];

  return (
    <div className="rounded-2xl border border-border bg-card shadow-card flex flex-col">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-danger/10">
            <UserX className="size-4 text-danger" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">이탈 위험 회원</p>
            <p className="text-[11px] text-muted-foreground">미납·만료·장기미출석</p>
          </div>
        </div>
        {members.length > 0 && (
          <span className="rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-bold text-danger">
            {members.length}명
          </span>
        )}
      </div>

      {/* 목록 */}
      <div className="flex-1 divide-y divide-border overflow-y-auto max-h-64">
        {isLoading ? (
          <div className="flex flex-col gap-3 p-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : !branchId ? (
          <p className="p-5 text-sm text-muted-foreground text-center">
            지점을 선택하면 이탈 위험 회원이 표시됩니다
          </p>
        ) : members.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground text-center">
            이탈 위험 회원이 없습니다 🎉
          </p>
        ) : (
          members.map((m) => {
            const meta = RISK_META[m.risk_type as AtRiskType];
            const Icon = meta.icon;
            const days = daysSince(m.since_date);
            return (
              <Link
                key={m.member_id}
                to={`/members/${m.member_id}`}
                className="flex items-center gap-3 px-5 py-3 hover:bg-muted/40 transition-colors"
              >
                {/* 뱃지 */}
                <span
                  className={cn(
                    "flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold shrink-0",
                    meta.color
                  )}
                >
                  <Icon className="size-3" />
                  {meta.label}
                </span>

                {/* 이름 */}
                <span className="flex-1 text-sm font-medium text-foreground truncate">
                  {m.member_name}
                </span>

                {/* 경과 일수 */}
                <span className="text-xs text-muted-foreground shrink-0">
                  {days > 0 ? `${days}일 전` : "오늘"}
                </span>
              </Link>
            );
          })
        )}
      </div>

      {/* 푸터 */}
      {members.length > 0 && (
        <div className="border-t border-border px-5 py-3">
          <Link
            to="/members?status=unpaid"
            className="text-xs text-primary hover:underline font-medium"
          >
            미납 회원 전체 보기 →
          </Link>
        </div>
      )}
    </div>
  );
}

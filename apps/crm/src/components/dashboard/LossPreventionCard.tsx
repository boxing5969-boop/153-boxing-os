/**
 * 손실방지 리포트 카드
 * - 최근 30일 핵심 거절 사유 5종 집계
 * - 기존 get_denied_reason_stats RPC 재사용 (DB 변경 없음)
 * - 각 사유 클릭 → AccessLogsPage 딥링크 (denied_reason URL param)
 */
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Shield,
  ShieldX,
  BanknoteIcon,
  TimerOff,
  KeyRound,
  UserX,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { getLossPreventionStats } from "@/services/dashboardWidgets";
import { cn } from "@/lib/cn";

interface StatRow {
  label: string;
  sub: string;
  value: number;
  icon: LucideIcon;
  deniedReason: string; // URL param 값
}

export function LossPreventionCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["loss-prevention-stats"],
    queryFn: getLossPreventionStats,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const rows: StatRow[] = [
    {
      label: "만료회원 출입 차단",
      sub: "이용권 만료 후 입장 시도",
      value: data?.expired_membership ?? 0,
      icon: ShieldX,
      deniedReason: "expired_membership",
    },
    {
      label: "미납회원 출입 차단",
      sub: "미납 상태 입장 시도",
      value: data?.unpaid ?? 0,
      icon: BanknoteIcon,
      deniedReason: "unpaid",
    },
    {
      label: "체험권 종료 후 출입 차단",
      sub: "체험 만료·횟수 초과 후 시도",
      value: data?.trial_blocked ?? 0,
      icon: TimerOff,
      deniedReason: "trial_expired",
    },
    {
      label: "유효 권한 없음",
      sub: "등록된 출입 권한 부재",
      value: data?.no_valid_grant ?? 0,
      icon: KeyRound,
      deniedReason: "no_valid_grant",
    },
    {
      label: "미등록/미연결 사용자",
      sub: "CRM 미연결 단말기 사용자",
      value: data?.unknown_user ?? 0,
      icon: UserX,
      deniedReason: "unknown_user",
    },
  ];

  const total = data?.total ?? 0;

  return (
    <div className="rounded-xl border border-border bg-card shadow-card">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md bg-success/10">
            <Shield className="size-3.5 text-success" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">손실방지 리포트</h2>
            <p className="text-xs text-muted-foreground">최근 30일 · 시스템이 막은 무단 입장</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!isLoading && (
            <span
              className={cn(
                "text-sm font-black tabular",
                total > 0 ? "text-success" : "text-muted-foreground"
              )}
            >
              총 {total}건 차단
            </span>
          )}
          <Link
            to="/access-logs"
            className="flex items-center gap-1 text-xs text-primary hover:underline font-medium"
          >
            전체 로그 <ArrowRight className="size-3" />
          </Link>
        </div>
      </div>

      {/* 사유별 행 */}
      <div className="divide-y divide-border">
        {rows.map((row) => {
          const Icon = row.icon;
          const hasValue = row.value > 0;
          return (
            <div
              key={row.deniedReason}
              className="flex items-center justify-between px-5 py-3"
            >
              {/* 아이콘 + 설명 */}
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "flex size-7 items-center justify-center rounded-md shrink-0",
                    hasValue
                      ? "bg-danger/10 text-danger"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  <Icon className="size-3.5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{row.label}</p>
                  <p className="text-xs text-muted-foreground">{row.sub}</p>
                </div>
              </div>

              {/* 카운트 + 딥링크 */}
              <div className="flex items-center gap-3 shrink-0">
                {isLoading ? (
                  <div className="h-5 w-12 animate-pulse rounded bg-muted" />
                ) : (
                  <span
                    className={cn(
                      "text-lg font-black tabular",
                      hasValue ? "text-danger" : "text-muted-foreground"
                    )}
                  >
                    {row.value}건
                  </span>
                )}
                <Link
                  to={`/access-logs?denied_reason=${row.deniedReason}`}
                  className="flex items-center justify-center size-6 rounded-md hover:bg-muted transition-colors"
                  title="출입 로그에서 보기"
                >
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {/* 푸터 */}
      <div className="border-t border-border px-5 py-2.5 bg-muted/20">
        <p className="text-[11px] text-muted-foreground">
          💡 차단 건수가 많은 사유는 회원 관리 정책을 점검하세요.
          상세 로그는{" "}
          <Link
            to="/access-logs"
            className="text-primary underline underline-offset-2"
          >
            출입 로그
          </Link>
          에서 확인할 수 있습니다.
        </p>
      </div>
    </div>
  );
}

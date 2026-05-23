/**
 * 오늘 연락할 회원 액션보드
 * - get_at_risk_members RPC 재사용 (AtRiskMembersCard와 queryKey 동일 → 캐시 공유)
 * - 각 회원: 전화 / 만료알림톡(expired만) / 회원상세 버튼
 * - 새 DB / Workers 수정 없음
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Phone,
  Send,
  User,
  CheckCircle2,
  AlertCircle,
  Clock3,
  Wifi,
  PhoneOff,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getAtRiskMembers, type AtRiskMember, type AtRiskType } from "@/services/dashboardWidgets";
import { sendMemberNotification } from "@/services/notificationSend";
import { cn } from "@/lib/cn";

// ── 위험 유형 메타 ──────────────────────────────────────────
const RISK_META: Record<AtRiskType, {
  label: string;
  badgeClass: string;
  icon: LucideIcon;
  action: string;           // 추천 행동 텍스트
  canNotify: boolean;       // 만료 알림톡 활성 여부
}> = {
  unpaid: {
    label: "미납",
    badgeClass: "bg-danger/10 text-danger",
    icon: AlertCircle,
    action: "미납 확인 및 연락 필요",
    canNotify: false,
  },
  expired: {
    label: "만료",
    badgeClass: "bg-warning/10 text-warning",
    icon: Clock3,
    action: "재등록 안내 알림톡 발송 권장",
    canNotify: true,
  },
  absent: {
    label: "미출석",
    badgeClass: "bg-blue-50 text-blue-500",
    icon: Wifi,
    action: "복귀 독려 연락 권장",
    canNotify: false,
  },
};

// ── 행당 알림톡 발송 상태 ───────────────────────────────────
type NotifyState = "idle" | "sending" | "done" | "error";

function ActionRow({ member }: { member: AtRiskMember }) {
  const [notifyState, setNotifyState] = useState<NotifyState>("idle");
  const meta = RISK_META[member.risk_type as AtRiskType] ?? RISK_META.absent;
  const Icon = meta.icon;
  const hasPhone = !!member.member_phone;

  // 마운트 시점의 현재 시각 — useState 초기 함수는 첫 렌더에만 실행됨 (impure 호출 격리)
  const [now] = useState(() => Date.now());
  const days = Math.floor((now - new Date(member.since_date).getTime()) / 86_400_000);

  async function handleNotify() {
    setNotifyState("sending");
    try {
      await sendMemberNotification(member.member_id);
      setNotifyState("done");
    } catch {
      setNotifyState("error");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 px-5 py-3.5 hover:bg-muted/30 transition-colors border-b border-border last:border-0">
      {/* 위험 배지 */}
      <span className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold shrink-0",
        meta.badgeClass
      )}>
        <Icon className="size-3" />
        {meta.label}
      </span>

      {/* 이름 + 추천행동 */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{member.member_name}</p>
        <p className="text-[11px] text-muted-foreground truncate">
          {meta.action}
          <span className="ml-1.5 opacity-60">
            · {days > 0 ? `${days}일 전` : "오늘"} 시작
          </span>
        </p>
      </div>

      {/* 액션 버튼 그룹 */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* 📞 전화 */}
        {hasPhone ? (
          <a
            href={`tel:${member.member_phone}`}
            className={cn(
              "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors",
              "border-success/30 bg-success/5 text-success hover:bg-success/15"
            )}
            title={member.member_phone ?? ""}
          >
            <Phone className="size-3" />
            전화
          </a>
        ) : (
          <span className={cn(
            "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold",
            "border-border bg-muted/30 text-muted-foreground/40 cursor-not-allowed"
          )} title="전화번호 없음">
            <PhoneOff className="size-3" />
            전화
          </span>
        )}

        {/* 📨 만료 알림톡 (expired만) */}
        {meta.canNotify ? (
          <button
            type="button"
            disabled={notifyState === "sending" || notifyState === "done"}
            onClick={handleNotify}
            className={cn(
              "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors",
              notifyState === "done"
                ? "border-success/30 bg-success/10 text-success cursor-default"
                : notifyState === "error"
                  ? "border-danger/30 bg-danger/5 text-danger"
                  : notifyState === "sending"
                    ? "border-border bg-muted text-muted-foreground cursor-wait"
                    : "border-primary/30 bg-primary/5 text-primary hover:bg-primary/15"
            )}
            title="만료 알림톡 발송"
          >
            {notifyState === "sending" ? (
              <><span className="size-3 rounded-full border border-current/30 border-t-current animate-spin" />발송 중</>
            ) : notifyState === "done" ? (
              <><CheckCircle2 className="size-3" />발송 완료</>
            ) : (
              <><Send className="size-3" />알림톡</>
            )}
          </button>
        ) : (
          <span className={cn(
            "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold",
            "border-border bg-muted/30 text-muted-foreground/30 cursor-not-allowed"
          )} title="만료 회원만 알림톡 발송 가능">
            <Send className="size-3" />
            알림톡
          </span>
        )}

        {/* 👤 회원 상세 */}
        <Link
          to={`/members/${member.member_id}`}
          className={cn(
            "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors",
            "border-border bg-card text-foreground hover:bg-muted/60"
          )}
          title="회원 상세 보기"
        >
          <User className="size-3" />
          상세
        </Link>
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-5 py-4 border-b border-border last:border-0">
      <div className="h-5 w-12 rounded-md bg-muted animate-pulse" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3.5 w-28 rounded bg-muted animate-pulse" />
        <div className="h-3 w-44 rounded bg-muted animate-pulse" />
      </div>
      <div className="flex gap-1.5">
        <div className="h-7 w-14 rounded-lg bg-muted animate-pulse" />
        <div className="h-7 w-16 rounded-lg bg-muted animate-pulse" />
        <div className="h-7 w-12 rounded-lg bg-muted animate-pulse" />
      </div>
    </div>
  );
}

export function ContactActionBoard() {
  const { profile } = useAuth();
  const branchId = profile?.branch_id;

  // AtRiskMembersCard와 동일한 queryKey → React Query 캐시 공유 (API 중복 호출 없음)
  const { data, isLoading } = useQuery({
    queryKey: ["at-risk-members", branchId],
    queryFn: () => getAtRiskMembers(branchId!),
    enabled: !!branchId,
    staleTime: 5 * 60_000,
  });

  const members = data ?? [];

  return (
    <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary/10">
            <Phone className="size-3.5 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">오늘 연락할 회원</h2>
            <p className="text-xs text-muted-foreground">미납 · 만료 · 장기미출석 우선순위</p>
          </div>
        </div>
        {!isLoading && members.length > 0 && (
          <span className="rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-bold text-danger">
            {members.length}명
          </span>
        )}
      </div>

      {/* 목록 */}
      {isLoading ? (
        <div>
          {[1, 2, 3].map((i) => <SkeletonRow key={i} />)}
        </div>
      ) : !branchId ? (
        <div className="px-5 py-8 text-center">
          <p className="text-sm text-muted-foreground">지점 정보를 불러오는 중입니다…</p>
        </div>
      ) : members.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
          <CheckCircle2 className="size-8 text-success/60" />
          <p className="text-sm font-semibold text-foreground">오늘 연락할 회원 없음</p>
          <p className="text-xs text-muted-foreground">미납·만료·장기미출석 회원이 없습니다 🎉</p>
        </div>
      ) : (
        <div className="divide-y-0">
          {members.map((m) => (
            <ActionRow key={m.member_id} member={m} />
          ))}
        </div>
      )}

      {/* 안내 푸터 */}
      {members.length > 0 && (
        <div className="border-t border-border px-5 py-2.5 bg-muted/20">
          <p className="text-[11px] text-muted-foreground">
            💡 알림톡 버튼은 만료 회원에게만 활성화됩니다. 미납·미출석 회원은 전화 또는 회원 상세에서 연락하세요.
          </p>
        </div>
      )}
    </div>
  );
}

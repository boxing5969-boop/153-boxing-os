/**
 * 코치 업무보드 페이지 (/coach)
 * - coach 역할 전용. 담당 회원 중심의 오늘 할 일 & 현황을 한 눈에 보여줌.
 * - 모든 데이터는 RLS(is_coach_of)에 의해 담당 회원만 자동 필터됨.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Users,
  UserX,
  Trophy,
  Scale,
  MessageSquare,
  ArrowRight,
  Calendar,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/cn";
import {
  getMyMemberCount,
  getMyAbsentMembers,
  getMyLevelInProgressMembers,
  getMyMissingMeasurementMembers,
  getMyDueFollowups,
  type AbsentMemberRow,
  type LevelInProgressRow,
  type MissingMeasurementRow,
  type FollowupRow,
} from "@/services/coachDashboard";

// ── 공통 카드 래퍼 ───────────────────────────────────────────
function SectionCard({
  icon: Icon,
  title,
  count,
  countTone = "default",
  children,
  emptyText,
  loading,
}: {
  icon: LucideIcon;
  title: string;
  count?: number;
  countTone?: "default" | "warning" | "danger" | "success";
  children: React.ReactNode;
  emptyText: string;
  loading: boolean;
}) {
  const toneCls = {
    default: "bg-primary/10 text-primary",
    warning: "bg-warning/10 text-warning",
    danger:  "bg-danger/10 text-danger",
    success: "bg-success/10 text-success",
  }[countTone];

  const countTextCls = {
    default: "text-foreground",
    warning: "text-warning",
    danger:  "text-danger",
    success: "text-success",
  }[countTone];

  return (
    <div className="rounded-xl border border-border bg-card shadow-card flex flex-col">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className={cn("flex size-8 items-center justify-center rounded-lg", toneCls)}>
            <Icon className="size-4" />
          </div>
          <span className="text-sm font-semibold text-foreground">{title}</span>
        </div>
        {count != null && (
          <span className={cn("text-2xl font-black tabular", countTextCls)}>{count}</span>
        )}
      </div>

      {/* 바디 */}
      <div className="flex-1 px-5 py-3">
        {loading ? (
          <div className="space-y-2.5 py-1">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-5 w-full animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : (
          children
        )}
      </div>

      {/* 빈 상태 */}
      {!loading && count === 0 && (
        <div className="px-5 pb-4 text-sm text-muted-foreground">{emptyText}</div>
      )}
    </div>
  );
}

// ── 멤버 행 공통 링크 ─────────────────────────────────────────
function MemberRow({
  memberId,
  name,
  meta,
  metaTone = "muted",
}: {
  memberId: string;
  name: string;
  meta: string;
  metaTone?: "muted" | "danger" | "warning";
}) {
  const metaCls = {
    muted:   "text-muted-foreground",
    danger:  "text-danger font-medium",
    warning: "text-warning font-medium",
  }[metaTone];

  return (
    <Link
      to={`/members/${memberId}`}
      className="flex items-center justify-between gap-3 py-2 rounded-lg px-1 -mx-1 hover:bg-muted/50 transition-colors group"
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="size-7 shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
          <span className="text-[10px] font-bold text-primary">{name[0]}</span>
        </div>
        <span className="text-sm font-medium text-foreground truncate">{name}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={cn("text-xs", metaCls)}>{meta}</span>
        <ArrowRight className="size-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
      </div>
    </Link>
  );
}

// ── 섹션: 미출석 ─────────────────────────────────────────────
function AbsentSection() {
  const { data = [], isLoading } = useQuery({
    queryKey: ["coach-absent-members"],
    queryFn: getMyAbsentMembers,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  return (
    <SectionCard
      icon={UserX}
      title="14일 이상 미출석"
      count={data.length}
      countTone={data.length > 0 ? "danger" : "default"}
      emptyText="14일 이상 미출석 회원이 없습니다 👍"
      loading={isLoading}
    >
      <div className="divide-y divide-border/50">
        {(data as AbsentMemberRow[]).map((m) => (
          <MemberRow
            key={m.member_id}
            memberId={m.member_id}
            name={m.member_name}
            meta={
              m.last_seen_date
                ? `${m.days_absent}일째 미출석`
                : "출석 기록 없음"
            }
            metaTone={m.days_absent >= 30 ? "danger" : "warning"}
          />
        ))}
      </div>
    </SectionCard>
  );
}

// ── 섹션: 레벨테스트 진행 중 ──────────────────────────────────
const TIER_LABEL: Record<string, string> = {
  white: "화이트",
  blue:  "블루",
  red:   "레드",
  black: "블랙",
};

function LevelProgressSection() {
  const { data = [], isLoading } = useQuery({
    queryKey: ["coach-level-in-progress"],
    queryFn: getMyLevelInProgressMembers,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  return (
    <SectionCard
      icon={Trophy}
      title="레벨테스트 진행 중"
      count={data.length}
      countTone={data.length > 0 ? "warning" : "default"}
      emptyText="진행 중인 레벨테스트가 없습니다"
      loading={isLoading}
    >
      <div className="divide-y divide-border/50">
        {(data as LevelInProgressRow[]).map((m) => (
          <MemberRow
            key={`${m.member_id}-${m.tier}-${m.level}`}
            memberId={m.member_id}
            name={m.member_name}
            meta={`${TIER_LABEL[m.tier] ?? m.tier} Lv.${m.level}`}
            metaTone="warning"
          />
        ))}
      </div>
    </SectionCard>
  );
}

// ── 섹션: 체성분 30일 미기록 ─────────────────────────────────
function MissingMeasurementSection() {
  const { data = [], isLoading } = useQuery({
    queryKey: ["coach-missing-measurement"],
    queryFn: getMyMissingMeasurementMembers,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  return (
    <SectionCard
      icon={Scale}
      title="체성분 30일 미기록"
      count={data.length}
      countTone={data.length > 0 ? "warning" : "default"}
      emptyText="30일 내 체성분 미기록 회원이 없습니다 👍"
      loading={isLoading}
    >
      <div className="divide-y divide-border/50">
        {(data as MissingMeasurementRow[]).map((m) => (
          <MemberRow
            key={m.member_id}
            memberId={m.member_id}
            name={m.member_name}
            meta={m.last_measured_date ? `마지막: ${m.last_measured_date}` : "기록 없음"}
            metaTone="warning"
          />
        ))}
      </div>
    </SectionCard>
  );
}

// ── 섹션: 팔로업 ─────────────────────────────────────────────
function FollowupSection() {
  const { data = [], isLoading } = useQuery({
    queryKey: ["coach-due-followups"],
    queryFn: getMyDueFollowups,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  return (
    <SectionCard
      icon={MessageSquare}
      title="오늘까지 팔로업 예정"
      count={data.length}
      countTone={data.length > 0 ? "danger" : "default"}
      emptyText="오늘 예정된 팔로업이 없습니다"
      loading={isLoading}
    >
      <div className="divide-y divide-border/50">
        {(data as FollowupRow[]).map((r) => {
          const dateStr = r.next_followup_at.slice(0, 10);
          return (
            <MemberRow
              key={r.id}
              memberId={r.member_id}
              name={r.member_name}
              meta={r.note ? `${dateStr} · ${r.note.slice(0, 20)}…` : dateStr}
              metaTone="danger"
            />
          );
        })}
      </div>
    </SectionCard>
  );
}

// ── 담당 회원 수 KPI ──────────────────────────────────────────
function MyMemberCountCard() {
  const { data: count = 0, isLoading } = useQuery({
    queryKey: ["coach-my-member-count"],
    queryFn: getMyMemberCount,
    staleTime: 60_000,
  });

  return (
    <div className="rounded-xl border border-border bg-card shadow-card p-5 flex items-center gap-4">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
        <Users className="size-6 text-primary" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground font-medium">담당 활성 회원</p>
        {isLoading ? (
          <div className="h-8 w-16 animate-pulse rounded bg-muted mt-1" />
        ) : (
          <p className="text-3xl font-black text-foreground tabular">{count}</p>
        )}
        <p className="text-xs text-muted-foreground mt-0.5">active + trial 기준</p>
      </div>
    </div>
  );
}

// ── 페이지 ───────────────────────────────────────────────────
export default function CoachDashboardPage() {
  const { profile } = useAuth();

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "좋은 아침이에요" : hour < 18 ? "안녕하세요" : "수고하셨어요";

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-foreground">
            {greeting}, {profile?.name ?? "코치"}님 👊
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            코치 · 오늘 담당 회원 현황을 확인하세요
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 shadow-card">
          <Calendar className="size-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">
            {new Date().toLocaleDateString("ko-KR", {
              month: "long",
              day: "numeric",
              weekday: "short",
            })}
          </span>
        </div>
      </div>

      {/* 담당 회원 수 */}
      <MyMemberCountCard />

      {/* 4개 업무 섹션 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AbsentSection />
        <FollowupSection />
        <LevelProgressSection />
        <MissingMeasurementSection />
      </div>
    </div>
  );
}

import { Link } from "react-router-dom";
import { Users, Send, MessageCircle, CheckCircle2, ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

interface ActionChip {
  label: string;
  count: number;
  href: string;
  icon: LucideIcon;
  tone: "warning" | "primary" | "default";
}

function Chip({ chip }: { chip: ActionChip }) {
  const Icon = chip.icon;

  const toneClass = {
    warning: "border-warning/30 bg-warning/5 text-warning hover:bg-warning/10",
    primary: "border-primary/30 bg-primary/5 text-primary hover:bg-primary/10",
    default: "border-border bg-muted/40 text-muted-foreground hover:bg-muted/70",
  }[chip.tone];

  const badgeClass = {
    warning: "bg-warning text-white",
    primary: "bg-primary text-white",
    default: "bg-muted-foreground/20 text-muted-foreground",
  }[chip.tone];

  return (
    <Link
      to={chip.href}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5",
        "text-sm font-semibold transition-colors",
        toneClass
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span>{chip.label}</span>
      <span className={cn("rounded-full px-1.5 py-0.5 text-xs font-bold tabular", badgeClass)}>
        {chip.count}건
      </span>
      <ChevronRight className="size-3 opacity-60" />
    </Link>
  );
}

interface TodayActionStripProps {
  pendingVisitorCount: number;
  pendingScheduledMessagesCount: number;
  dueFollowupsCount: number;
}

export function TodayActionStrip({
  pendingVisitorCount,
  pendingScheduledMessagesCount,
  dueFollowupsCount,
}: TodayActionStripProps) {
  const chips: ActionChip[] = [
    {
      label: "방문 대기",
      count: pendingVisitorCount,
      href: "/visitors",
      icon: Users,
      tone: pendingVisitorCount > 0 ? "warning" : "default",
    },
    {
      label: "예약 발송 대기",
      count: pendingScheduledMessagesCount,
      href: "/admin/scheduled-msgs",
      icon: Send,
      tone: pendingScheduledMessagesCount > 0 ? "primary" : "default",
    },
    {
      label: "상담 팔로업",
      count: dueFollowupsCount,
      href: "/visitors",
      icon: MessageCircle,
      tone: dueFollowupsCount > 0 ? "warning" : "default",
    },
  ];

  const totalActions = pendingVisitorCount + pendingScheduledMessagesCount + dueFollowupsCount;

  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-4 shadow-card">
      <div className="flex flex-wrap items-center gap-3">
        {/* 제목 */}
        <div className="flex items-center gap-2 shrink-0 mr-2">
          {totalActions === 0 ? (
            <CheckCircle2 className="size-4 text-success" />
          ) : (
            <div className="size-4 rounded-full bg-warning/20 flex items-center justify-center">
              <div className="size-2 rounded-full bg-warning animate-pulse" />
            </div>
          )}
          <span className="text-sm font-bold text-foreground">오늘 할 일</span>
          {totalActions > 0 && (
            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-bold text-warning">
              {totalActions}건
            </span>
          )}
        </div>

        {/* 구분선 */}
        <div className="hidden sm:block w-px h-5 bg-border shrink-0" />

        {totalActions === 0 ? (
          <span className="text-sm text-muted-foreground">오늘 처리할 항목이 없습니다 ✅</span>
        ) : (
          <div className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <Chip key={chip.label} chip={chip} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

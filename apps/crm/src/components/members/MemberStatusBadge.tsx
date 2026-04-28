import type { MemberStatus } from "@153/shared";
import { cn } from "@/lib/cn";

const STYLES: Record<MemberStatus, { bg: string; text: string; dot: string }> = {
  active:    { bg: "bg-success/10",  text: "text-success",         dot: "bg-success" },
  trial:     { bg: "bg-primary/10",  text: "text-primary",         dot: "bg-primary" },
  expired:   { bg: "bg-muted",       text: "text-muted-foreground", dot: "bg-muted-foreground" },
  unpaid:    { bg: "bg-warning/10",  text: "text-warning",         dot: "bg-warning" },
  suspended: { bg: "bg-warning/10",  text: "text-warning",         dot: "bg-warning" },
  withdrawn: { bg: "bg-danger/10",   text: "text-danger",          dot: "bg-danger" },
};

const LABELS: Record<MemberStatus, string> = {
  active:    "정상",
  trial:     "체험",
  expired:   "만료",
  unpaid:    "미납",
  suspended: "정지",
  withdrawn: "탈퇴",
};

export const MEMBER_STATUS_VALUES: MemberStatus[] = [
  "active", "trial", "expired", "suspended", "unpaid", "withdrawn",
];

export function memberStatusLabel(s: MemberStatus) {
  return LABELS[s];
}

export default function MemberStatusBadge({ status }: { status: MemberStatus }) {
  const s = STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        s.bg, s.text
      )}
    >
      <span className={cn("size-1.5 rounded-full", s.dot)} />
      {LABELS[status]}
    </span>
  );
}

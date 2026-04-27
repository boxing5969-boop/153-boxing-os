import type { MemberStatus } from "@153/shared";
import { cn } from "@/lib/cn";

const STYLES: Record<MemberStatus, string> = {
  active: "bg-green-100 text-green-800",
  trial: "bg-blue-100 text-blue-800",
  expired: "bg-gray-200 text-gray-700",
  unpaid: "bg-yellow-100 text-yellow-800",
  suspended: "bg-orange-100 text-orange-800",
  withdrawn: "bg-red-100 text-red-700",
};

const LABELS: Record<MemberStatus, string> = {
  active: "정상",
  trial: "체험",
  expired: "만료",
  unpaid: "미납",
  suspended: "정지",
  withdrawn: "탈퇴",
};

export const MEMBER_STATUS_VALUES: MemberStatus[] = [
  "active",
  "trial",
  "expired",
  "suspended",
  "unpaid",
  "withdrawn",
];

export function memberStatusLabel(status: MemberStatus): string {
  return LABELS[status];
}

export default function MemberStatusBadge({ status }: { status: MemberStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        STYLES[status]
      )}
    >
      {LABELS[status]}
    </span>
  );
}

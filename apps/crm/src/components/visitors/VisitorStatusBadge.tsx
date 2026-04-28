import type { VisitPurpose, VisitorRequestStatus } from "@153/shared";
import { cn } from "@/lib/cn";

const STATUS_STYLES: Record<VisitorRequestStatus, string> = {
  requested: "bg-blue-100 text-blue-800",
  approved: "bg-green-100 text-green-800",
  denied: "bg-red-100 text-red-700",
  completed: "bg-gray-200 text-gray-700",
};
const STATUS_LABELS: Record<VisitorRequestStatus, string> = {
  requested: "신청됨",
  approved: "승인",
  denied: "거절",
  completed: "완료",
};

const PURPOSE_LABELS: Record<VisitPurpose, string> = {
  consultation: "상담 예약",
  tour: "시설 견학",
  trial: "체험 희망",
  registration: "등록 문의",
};

export const VISITOR_STATUS_VALUES: VisitorRequestStatus[] = [
  "requested",
  "approved",
  "denied",
  "completed",
];
export const VISITOR_PURPOSE_VALUES: VisitPurpose[] = [
  "consultation",
  "tour",
  "trial",
  "registration",
];

export function visitorStatusLabel(s: VisitorRequestStatus): string {
  return STATUS_LABELS[s];
}
export function visitPurposeLabel(p: VisitPurpose): string {
  return PURPOSE_LABELS[p];
}

export function VisitorStatusBadge({ status }: { status: VisitorRequestStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        STATUS_STYLES[status]
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

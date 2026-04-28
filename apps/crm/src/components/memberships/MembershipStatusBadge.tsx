import type { MembershipStatus, PaymentStatus, TrialPassStatus } from "@153/shared";
import { cn } from "@/lib/cn";

const MEMBERSHIP_STYLES: Record<MembershipStatus, string> = {
  active: "bg-green-100 text-green-800",
  expired: "bg-gray-200 text-gray-700",
  paused: "bg-orange-100 text-orange-800",
  canceled: "bg-red-100 text-red-700",
};
const MEMBERSHIP_LABELS: Record<MembershipStatus, string> = {
  active: "이용중",
  expired: "만료",
  paused: "정지",
  canceled: "취소",
};

const PAYMENT_STYLES: Record<PaymentStatus, string> = {
  paid: "bg-green-50 text-green-700",
  partial: "bg-blue-50 text-blue-700",
  unpaid: "bg-yellow-50 text-yellow-800",
  refunded: "bg-red-50 text-red-700",
};
const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  paid: "결제완료",
  partial: "부분결제",
  unpaid: "미납",
  refunded: "환불",
};

const TRIAL_STYLES: Record<TrialPassStatus, string> = {
  active: "bg-blue-100 text-blue-800",
  used: "bg-gray-200 text-gray-700",
  expired: "bg-gray-200 text-gray-700",
  canceled: "bg-red-100 text-red-700",
};
const TRIAL_LABELS: Record<TrialPassStatus, string> = {
  active: "사용가능",
  used: "사용완료",
  expired: "만료",
  canceled: "취소",
};

export const MEMBERSHIP_STATUS_VALUES: MembershipStatus[] = [
  "active",
  "expired",
  "paused",
  "canceled",
];
export const TRIAL_STATUS_VALUES: TrialPassStatus[] = [
  "active",
  "used",
  "expired",
  "canceled",
];

export function membershipStatusLabel(s: MembershipStatus) {
  return MEMBERSHIP_LABELS[s];
}
export function paymentStatusLabel(s: PaymentStatus) {
  return PAYMENT_LABELS[s];
}
export function trialStatusLabel(s: TrialPassStatus) {
  return TRIAL_LABELS[s];
}

export function MembershipStatusBadge({ status }: { status: MembershipStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        MEMBERSHIP_STYLES[status]
      )}
    >
      {MEMBERSHIP_LABELS[status]}
    </span>
  );
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        PAYMENT_STYLES[status]
      )}
    >
      {PAYMENT_LABELS[status]}
    </span>
  );
}

export function TrialStatusBadge({ status }: { status: TrialPassStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        TRIAL_STYLES[status]
      )}
    >
      {TRIAL_LABELS[status]}
    </span>
  );
}

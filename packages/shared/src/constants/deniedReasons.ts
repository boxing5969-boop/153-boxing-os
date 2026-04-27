export const DENIED_REASON_LABELS = {
  expired_membership: "이용권이 만료되었습니다.",
  unpaid: "이용권 미납 상태입니다.",
  suspended: "회원 정지 상태입니다.",
  no_valid_grant: "출입 권한이 없습니다.",
  trial_expired: "체험권 기간이 종료됐습니다.",
  trial_max_used: "체험권 사용 횟수를 초과했습니다.",
  qr_expired: "QR 코드가 만료됐습니다.",
  qr_already_used: "이미 사용된 QR 코드입니다.",
  qr_invalid_signature: "QR 코드가 유효하지 않습니다.",
  device_error: "단말기 오류가 발생했습니다.",
  unknown_user: "등록되지 않은 사용자입니다.",
  outside_allowed_time: "허용된 시간이 아닙니다.",
  consent_revoked: "동의 철회 상태입니다.",
} as const;

export type DeniedReason = keyof typeof DENIED_REASON_LABELS;

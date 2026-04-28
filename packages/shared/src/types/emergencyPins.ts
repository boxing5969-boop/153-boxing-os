export type EmergencyPinStatus = "active" | "used" | "expired" | "revoked";

export interface EmergencyPin {
  id: string;
  branch_id: string;
  pin_hash?: string; // 클라이언트엔 보통 노출 안 함
  purpose: string | null;
  issued_by: string | null;
  issued_at: string;
  expires_at: string;
  max_uses: number;
  used_count: number;
  last_used_at: string | null;
  status: EmergencyPinStatus;
  created_at: string;
}

export const EMERGENCY_PIN_STATUS_VALUES: EmergencyPinStatus[] = [
  "active",
  "used",
  "expired",
  "revoked",
];

export const EMERGENCY_PIN_STATUS_LABELS: Record<EmergencyPinStatus, string> = {
  active: "사용 가능",
  used: "사용 완료",
  expired: "만료",
  revoked: "취소",
};

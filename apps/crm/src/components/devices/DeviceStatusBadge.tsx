import type { DeviceStatus, DeviceType, DeviceVendor } from "@153/shared";
import { cn } from "@/lib/cn";

const STATUS_STYLES: Record<DeviceStatus, string> = {
  active: "bg-green-100 text-green-800",
  inactive: "bg-gray-200 text-gray-700",
  error: "bg-red-100 text-red-700",
};
const STATUS_LABELS: Record<DeviceStatus, string> = {
  active: "정상",
  inactive: "비활성",
  error: "오류",
};

const TYPE_LABELS: Record<DeviceType, string> = {
  face_terminal: "얼굴인식",
  qr_reader: "QR 리더",
  card_reader: "카드 리더",
  relay: "릴레이",
  kiosk: "키오스크",
};

const VENDOR_LABELS: Record<DeviceVendor, string> = {
  suprema: "Suprema",
  zkteco: "ZKTeco",
  hikvision: "Hikvision",
  mock: "Mock",
  custom: "Custom",
  other: "기타",
};

export const DEVICE_STATUS_VALUES: DeviceStatus[] = ["active", "inactive", "error"];

export function deviceStatusLabel(s: DeviceStatus): string {
  return STATUS_LABELS[s];
}

export function deviceTypeLabel(t: DeviceType): string {
  return TYPE_LABELS[t];
}

export function deviceVendorLabel(v: DeviceVendor): string {
  return VENDOR_LABELS[v];
}

export function DeviceStatusBadge({ status }: { status: DeviceStatus }) {
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

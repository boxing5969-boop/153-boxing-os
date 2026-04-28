import type { AccessResult, CredentialType } from "@153/shared";
import { cn } from "@/lib/cn";

const RESULT_STYLES: Record<AccessResult, string> = {
  success: "bg-green-100 text-green-800",
  denied: "bg-red-100 text-red-700",
  error: "bg-orange-100 text-orange-800",
};
const RESULT_LABELS: Record<AccessResult, string> = {
  success: "성공",
  denied: "거절",
  error: "오류",
};

const CREDENTIAL_LABELS: Record<CredentialType, string> = {
  face: "얼굴",
  qr: "QR",
  card: "카드",
  pin: "PIN",
  admin: "관리자",
  visitor: "방문자",
};

export const ACCESS_RESULT_VALUES: AccessResult[] = ["success", "denied", "error"];
export const CREDENTIAL_TYPE_VALUES: CredentialType[] = [
  "face",
  "qr",
  "card",
  "pin",
  "admin",
  "visitor",
];

export function accessResultLabel(r: AccessResult): string {
  return RESULT_LABELS[r];
}

export function credentialLabel(c: CredentialType): string {
  return CREDENTIAL_LABELS[c];
}

export function AccessResultBadge({ result }: { result: AccessResult }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        RESULT_STYLES[result]
      )}
    >
      {RESULT_LABELS[result]}
    </span>
  );
}

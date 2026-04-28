import type { AccessResult, CredentialType } from "@153/shared";
import { cn } from "@/lib/cn";

const RESULT_STYLES: Record<AccessResult, { bg: string; text: string; dot: string; row: string }> = {
  success: { bg: "bg-success/10", text: "text-success",         dot: "bg-success",         row: "hover:bg-success/5" },
  denied:  { bg: "bg-danger/10",  text: "text-danger",          dot: "bg-danger",           row: "hover:bg-danger/5" },
  error:   { bg: "bg-warning/10", text: "text-warning",         dot: "bg-warning",          row: "hover:bg-warning/5" },
};
const RESULT_LABELS: Record<AccessResult, string> = {
  success: "성공",
  denied:  "거절",
  error:   "오류",
};

const CREDENTIAL_STYLES: Record<CredentialType, string> = {
  face:    "bg-purple-100 text-purple-700",
  qr:      "bg-primary/10 text-primary",
  card:    "bg-muted text-muted-foreground",
  pin:     "bg-warning/10 text-warning",
  admin:   "bg-danger/10 text-danger",
  visitor: "bg-muted text-muted-foreground",
};

const CREDENTIAL_LABELS: Record<CredentialType, string> = {
  face:    "얼굴인식",
  qr:      "QR",
  card:    "카드",
  pin:     "PIN",
  admin:   "관리자",
  visitor: "방문자",
};

export const ACCESS_RESULT_VALUES: AccessResult[] = ["success", "denied", "error"];
export const CREDENTIAL_TYPE_VALUES: CredentialType[] = ["face", "qr", "card", "pin", "admin", "visitor"];

export function accessResultLabel(r: AccessResult) { return RESULT_LABELS[r]; }
export function credentialLabel(c: CredentialType) { return CREDENTIAL_LABELS[c]; }
export function accessResultRowClass(r: AccessResult) { return RESULT_STYLES[r].row; }

export function AccessResultBadge({ result }: { result: AccessResult }) {
  const s = RESULT_STYLES[result];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold", s.bg, s.text)}>
      <span className={cn("size-1.5 rounded-full", s.dot)} />
      {RESULT_LABELS[result]}
    </span>
  );
}

export function CredentialBadge({ type }: { type: CredentialType }) {
  return (
    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", CREDENTIAL_STYLES[type])}>
      {CREDENTIAL_LABELS[type]}
    </span>
  );
}

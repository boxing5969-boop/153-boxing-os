export type ConsentType = "face_recognition" | "privacy" | "marketing" | "terms";

export interface ConsentRecord {
  id: string;
  member_id?: string;
  consent_type: ConsentType;
  agreed: boolean;
  agreed_at: string;
  revoked_at: string | null;
  created_at?: string;
  /** RPC list_member_consents 가 계산해서 반환하는 derived 필드 */
  is_active?: boolean;
}

export const CONSENT_TYPE_VALUES: ConsentType[] = [
  "face_recognition",
  "privacy",
  "marketing",
  "terms",
];

export const CONSENT_TYPE_LABELS: Record<ConsentType, string> = {
  face_recognition: "얼굴인식",
  privacy: "개인정보 수집·이용",
  marketing: "마케팅 수신",
  terms: "이용약관",
};

export const CONSENT_TYPE_DESCRIPTIONS: Record<ConsentType, string> = {
  face_recognition:
    "단말기 얼굴인식 사용. 철회 시 모든 등록 단말기에서 자동 삭제됩니다.",
  privacy: "이름·전화·생년월일 등 개인정보 처리.",
  marketing: "프로모션·이벤트 안내 SMS·이메일 발송.",
  terms: "153 BOXING 이용약관.",
};

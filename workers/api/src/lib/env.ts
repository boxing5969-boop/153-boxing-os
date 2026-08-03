export interface Env {
  ENVIRONMENT: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_JWT_SECRET: string;
  QR_SIGNING_SECRET: string;
  DEVICE_API_KEY: string;
  DEVICE_KMS_KEY: string;
  SENTRY_DSN?: string;
  PARTNER_API_KEY?: string;
  SLACK_WEBHOOK_URL?: string;
  // Kakao AlimTalk via Solapi (optional -- skip if not set)
  SOLAPI_API_KEY?: string;
  SOLAPI_API_SECRET?: string;
  SOLAPI_SENDER_KEY?: string;
  SENDER_PHONE?: string;
  KAKAO_EXPIRY_TPL_D7?: string;
  KAKAO_EXPIRY_TPL_D3?: string;
  KAKAO_EXPIRY_TPL_D1?: string;
  PAGES_URL?: string;  // CRM 프론트엔드 URL (계약서 링크 생성용)
  // FC AI 메시지 생성용 LLM 키 (미설정 시 규칙 기반으로 자동 폴백)
  ANTHROPIC_API_KEY?: string;
  // 결제 어댑터 (결제선생 — 파트너 계약 후 채움). 미설정 시 mock.
  PAYMENT_PROVIDER?: string; // 'mock' | 'payssam'
  PAYMENT_DRY_RUN?: string; // 'false' 가 아니면 dry-run(기본 true)
  PAYSSAM_API_URL?: string;
  PAYSSAM_API_KEY?: string;
  PAYSSAM_MERCHANT_ID?: string;
  // 브로제이 출입·안면인식 어댑터 (오픈 API 명세 수령 후 채움)
  BROJ_API_URL?: string;
  BROJ_API_KEY?: string;
  // FC-4 문 제어 릴레이 (크라이저 명세 수령 후 채움). 미설정 = no-op.
  DOOR_RELAY_PROVIDER?: string; // 'mock' | 'kreiser'
  DOOR_RELAY_API_URL?: string;
  DOOR_RELAY_API_KEY?: string;
}

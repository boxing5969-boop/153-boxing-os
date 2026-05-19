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
}

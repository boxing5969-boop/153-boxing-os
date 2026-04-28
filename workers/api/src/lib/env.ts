export interface Env {
  ENVIRONMENT: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_JWT_SECRET: string;
  QR_SIGNING_SECRET: string;
  DEVICE_API_KEY: string;
  DEVICE_KMS_KEY: string;
  /** 선택 — 미설정 시 Sentry 비활성화 (no-op) */
  SENTRY_DSN?: string;
  /** 선택 — 외부 파트너(랭킹업앱) 연동 시. 미설정 시 /api/external/* 거부 */
  PARTNER_API_KEY?: string;
}

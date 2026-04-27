export interface Env {
  ENVIRONMENT: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  QR_SIGNING_SECRET?: string;
  DEVICE_KMS_KEY?: string;
  // KV namespaces (Phase 4)
  // QR_USED?: KVNamespace;
}

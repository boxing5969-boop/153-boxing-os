/**
 * Supabase service_role 클라이언트 싱글톤.
 * 절대 프런트에 노출 금지.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadConfig } from "../config";

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  const cfg = loadConfig();
  _client = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "x-application-name": "billing-proxy" } },
  });
  return _client;
}

/** 테스트용 — 외부 mock 주입 */
export function setSupabaseForTest(client: SupabaseClient | null): void {
  _client = client;
}

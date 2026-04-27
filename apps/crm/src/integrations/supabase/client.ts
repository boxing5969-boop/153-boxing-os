import { createClient } from "@supabase/supabase-js";
import type { Database } from "@153/shared";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Supabase env missing. Check apps/crm/.env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)"
  );
}

// Database 타입은 Phase 3 마이그레이션 적용 후
//   bunx supabase gen types typescript --project-id <ref> > packages/shared/src/types/db.ts
// 로 갱신 권장 (현재는 placeholder).
export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

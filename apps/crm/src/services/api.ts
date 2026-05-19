/**
 * Workers API 공통 유틸
 * - API_URL: VITE_API_BASE_URL 환경변수
 * - getAuthHeaders: Supabase 세션 토큰을 Bearer 헤더로 변환
 */
import { supabase } from "@/integrations/supabase/client";

export const API_URL = (import.meta.env.VITE_API_BASE_URL as string) ?? "";

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

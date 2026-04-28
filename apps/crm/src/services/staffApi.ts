import { supabase } from "@/integrations/supabase/client";
import type { UserRole } from "@153/shared";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";

export interface InviteStaffInput {
  email: string;
  name: string;
  role: UserRole;
  branch_id?: string;
  phone?: string;
}

export interface InviteStaffResult {
  profile_id: string;
  user_id: string;
  email: string;
  name: string;
  role: UserRole;
  temp_password: string;
}

interface ApiSuccess<T> {
  success: true;
  data: T;
  message?: string;
}
interface ApiFailure {
  success: false;
  error: { code: string; message: string };
}

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const session = await supabase.auth.getSession();
  const jwt = session.data.session?.access_token;
  if (!jwt) throw new Error("로그인 세션이 만료됐습니다. 다시 로그인하세요.");

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
      ...(init?.headers ?? {}),
    },
  });

  let env: ApiSuccess<T> | ApiFailure;
  try {
    env = (await res.json()) as ApiSuccess<T> | ApiFailure;
  } catch {
    throw new Error(`HTTP ${res.status} — 응답 파싱 실패`);
  }
  if (!env.success) throw new Error(env.error.message ?? `HTTP ${res.status}`);
  return env.data;
}

export async function inviteStaff(input: InviteStaffInput): Promise<InviteStaffResult> {
  return authedFetch<InviteStaffResult>("/api/staff/invite", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

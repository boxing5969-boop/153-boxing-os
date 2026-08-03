/**
 * FC-3: 얼굴 출석 관리 — Workers API(/api/face-admin/*) 호출.
 * face_profiles 는 RLS 정책이 없어(서비스롤 전용) 프런트 직접 조회가 불가하다.
 * 반드시 워커(관리자 JWT 라우트) 경유로 읽고/해제한다. 얼굴 임베딩은 오가지 않는다.
 */
import { supabase } from "@/integrations/supabase/client";
import type { AccessResult, DeniedReason } from "@153/shared";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";

export interface FaceEnrollmentRow {
  member_id: string;
  name: string;
  phone: string | null;
  member_status: string;
  branch_id: string;
  branch_name: string | null;
  shots: number;
  enrolled_at: string | null;
  consent_at: string | null;
}

export interface FaceLogRow {
  id: string;
  branch_id: string;
  branch_name: string | null;
  member_id: string | null;
  member_name: string | null;
  result: AccessResult;
  denied_reason: DeniedReason | null;
  occurred_at: string;
}

/** "" = 전체, "ok" = 사유 없음(정상), 나머지 = 해당 거절 사유 */
export type FaceReasonFilter = "" | "ok" | DeniedReason;

export interface FaceLogFilters {
  branch_id?: string | null;
  reason?: FaceReasonFilter;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}

export interface FaceLogListResult {
  rows: FaceLogRow[];
  total: number;
  /** true = 파일럿 소프트 모드(거절 사유가 있어도 통과 처리 중) */
  pilot_soft: boolean;
}

/** 얼굴 인식이 실제로 남기는 사유의 짧은 표시 라벨 */
export const FACE_REASON_SHORT: Partial<Record<DeniedReason, string>> = {
  expired_membership: "이용권 만료",
  no_valid_grant: "이용권 없음",
  unknown_user: "미등록(명부 없음)",
};

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

export async function listFaceEnrollments(
  branchId?: string | null
): Promise<{ rows: FaceEnrollmentRow[]; total: number }> {
  const qs = branchId ? `?branch_id=${encodeURIComponent(branchId)}` : "";
  return authedFetch<{ rows: FaceEnrollmentRow[]; total: number }>(
    `/api/face-admin/enrollments${qs}`
  );
}

export async function listFaceLogs(filters: FaceLogFilters): Promise<FaceLogListResult> {
  const p = new URLSearchParams();
  if (filters.branch_id) p.set("branch_id", filters.branch_id);
  if (filters.reason) p.set("reason", filters.reason);
  if (filters.from) p.set("from", filters.from);
  if (filters.to) p.set("to", filters.to);
  p.set("limit", String(filters.limit ?? 20));
  p.set("offset", String(filters.offset ?? 0));
  return authedFetch<FaceLogListResult>(`/api/face-admin/logs?${p.toString()}`);
}

export interface DeactivateFaceResult {
  member_id: string;
  deactivated: number;
  consents_revoked: number;
}

export async function deactivateFaceEnrollment(memberId: string): Promise<DeactivateFaceResult> {
  return authedFetch<DeactivateFaceResult>("/api/face-admin/deactivate", {
    method: "POST",
    body: JSON.stringify({ member_id: memberId }),
  });
}

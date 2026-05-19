/**
 * 체성분 측정 + 운동 일지 서비스 레이어
 */
import { getAuthHeaders, API_URL } from "./api";

// ── 타입 ──────────────────────────────────────────────────────

export interface BodyMeasurement {
  id: string;
  member_id: string;
  branch_id: string;
  measured_at: string;
  weight_kg: number | null;
  body_fat_pct: number | null;
  muscle_mass_kg: number | null;
  bmi: number | null;
  note: string | null;
  created_at: string;
}

export type WorkoutIntensity = "light" | "moderate" | "intense";
export const INTENSITY_LABELS: Record<WorkoutIntensity, string> = {
  light:    "가벼움",
  moderate: "보통",
  intense:  "강도 높음",
};
export const INTENSITY_COLORS: Record<WorkoutIntensity, string> = {
  light:    "bg-blue-50 text-blue-700",
  moderate: "bg-yellow-50 text-yellow-700",
  intense:  "bg-red-50 text-red-700",
};

export interface WorkoutLog {
  id: string;
  member_id: string;
  branch_id: string;
  coach_id: string | null;
  logged_date: string;
  duration_min: number | null;
  intensity: WorkoutIntensity | null;
  note: string | null;
  created_at: string;
  staff?: { name: string } | null;
}

// ── API 함수 ──────────────────────────────────────────────────

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { ...headers, ...(options?.headers as Record<string, string> | undefined) },
  });
  const json = await res.json() as { success: boolean; data: T; message?: string };
  if (!json.success) throw new Error(json.message ?? "오류가 발생했습니다");
  return json.data;
}

// 체성분 목록
export const listMeasurements = (memberId: string, limit = 50) =>
  apiFetch<BodyMeasurement[]>(`/api/fitness/members/${memberId}/measurements?limit=${limit}`);

// 체성분 등록
export const createMeasurement = (
  memberId: string,
  body: Partial<Omit<BodyMeasurement, "id" | "member_id" | "branch_id" | "created_at">>
) =>
  apiFetch<BodyMeasurement>(`/api/fitness/members/${memberId}/measurements`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// 체성분 삭제
export const deleteMeasurement = (id: string) =>
  apiFetch<{ deleted: boolean }>(`/api/fitness/measurements/${id}`, { method: "DELETE" });

// 운동 일지 목록
export const listWorkouts = (memberId: string, limit = 30) =>
  apiFetch<WorkoutLog[]>(`/api/fitness/members/${memberId}/workouts?limit=${limit}`);

// 운동 일지 등록
export const createWorkout = (
  memberId: string,
  body: Partial<Omit<WorkoutLog, "id" | "member_id" | "branch_id" | "created_at" | "staff">>
) =>
  apiFetch<WorkoutLog>(`/api/fitness/members/${memberId}/workouts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// 운동 일지 삭제
export const deleteWorkout = (id: string) =>
  apiFetch<{ deleted: boolean }>(`/api/fitness/workouts/${id}`, { method: "DELETE" });

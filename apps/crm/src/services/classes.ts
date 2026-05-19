/**
 * 수업 / PT 관리 서비스 레이어
 */
import { getAuthHeaders, API_URL } from "./api";

// ── 타입 ──────────────────────────────────────────────────────

export type ClassType = "group" | "pt" | "open";
export const CLASS_TYPE_LABELS: Record<ClassType, string> = {
  group: "그룹 수업",
  pt: "개인 PT",
  open: "자유 훈련",
};
export const CLASS_TYPE_COLORS: Record<ClassType, string> = {
  group: "bg-blue-50 text-blue-700",
  pt: "bg-purple-50 text-purple-700",
  open: "bg-green-50 text-green-700",
};

export type SessionStatus = "scheduled" | "in_progress" | "completed" | "canceled";
export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  scheduled: "예정",
  in_progress: "진행 중",
  completed: "완료",
  canceled: "취소",
};

export type BookingStatus = "booked" | "attended" | "no_show" | "canceled";
export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  booked: "예약",
  attended: "출석",
  no_show: "결석",
  canceled: "취소",
};

export type PtStatus = "scheduled" | "completed" | "no_show" | "canceled";
export const PT_STATUS_LABELS: Record<PtStatus, string> = {
  scheduled: "예정",
  completed: "완료",
  no_show: "결석",
  canceled: "취소",
};

export interface GymClass {
  id: string;
  branch_id: string;
  coach_id: string | null;
  name: string;
  class_type: ClassType;
  capacity: number;
  duration_min: number;
  description: string | null;
  color: string;
  is_active: boolean;
  created_at: string;
  staff?: { name: string } | null;
}

export interface ClassSession {
  id: string;
  class_id: string;
  branch_id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  status: SessionStatus;
  note: string | null;
  classes?: { id: string; name: string; class_type: ClassType; color: string } | null;
  staff?: { id: string; name: string } | null;
  class_bookings?: ClassBooking[];
}

export interface ClassBooking {
  id: string;
  session_id: string;
  member_id: string;
  status: BookingStatus;
  booked_at: string;
  checked_in_at: string | null;
  members?: { name: string } | null;
}

export interface PtSession {
  id: string;
  member_id: string;
  coach_id: string | null;
  branch_id: string;
  session_date: string;
  start_time: string;
  duration_min: number;
  status: PtStatus;
  note: string | null;
  created_at: string;
  staff?: { name: string } | null;
}

// ── API 함수 ──────────────────────────────────────────────────

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_URL}${path}`, { ...options, headers: { ...headers, ...(options?.headers as Record<string, string> | undefined) } });
  const json = await res.json() as { success: boolean; data: T; message?: string };
  if (!json.success) throw new Error(json.message ?? "오류가 발생했습니다");
  return json.data;
}

// 수업 목록
export const listClasses = (branchId: string) =>
  apiFetch<GymClass[]>(`/api/classes/branches/${branchId}`);

// 수업 등록
export const createClass = (branchId: string, body: Partial<GymClass>) =>
  apiFetch<GymClass>(`/api/classes/branches/${branchId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// 수업 수정
export const updateClass = (classId: string, body: Partial<GymClass>) =>
  apiFetch<GymClass>(`/api/classes/${classId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// 세션 목록 (날짜 or 주간)
export const listSessions = (branchId: string, date: string, week = false) =>
  apiFetch<ClassSession[]>(`/api/classes/sessions/branches/${branchId}?date=${date}&week=${week}`);

// 세션 생성
export const createSession = (branchId: string, body: {
  class_id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  capacity?: number;
  coach_id?: string | null;
  note?: string | null;
}) =>
  apiFetch<ClassSession>(`/api/classes/sessions/branches/${branchId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// 세션 상태 변경
export const updateSessionStatus = (sessionId: string, status: SessionStatus) =>
  apiFetch<ClassSession>(`/api/classes/sessions/${sessionId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });

// 예약 추가
export const createBooking = (sessionId: string, memberId: string) =>
  apiFetch<ClassBooking>(`/api/classes/sessions/${sessionId}/bookings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ member_id: memberId }),
  });

// 출석 처리
export const updateBookingStatus = (bookingId: string, status: BookingStatus) =>
  apiFetch<ClassBooking>(`/api/classes/bookings/${bookingId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });

// PT 이력
export const listPtSessions = (memberId: string) =>
  apiFetch<PtSession[]>(`/api/classes/pt/members/${memberId}`);

// PT 세션 등록
export const createPtSession = (branchId: string, body: {
  member_id: string;
  coach_id?: string | null;
  session_date: string;
  start_time: string;
  duration_min?: number;
  membership_id?: string | null;
  note?: string | null;
}) =>
  apiFetch<PtSession>(`/api/classes/pt/branches/${branchId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// PT 세션 상태 변경
export const updatePtStatus = (ptId: string, status: PtStatus, note?: string) =>
  apiFetch<PtSession>(`/api/classes/pt/${ptId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, note }),
  });

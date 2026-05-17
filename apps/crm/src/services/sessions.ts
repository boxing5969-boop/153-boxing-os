import { supabase } from "@/integrations/supabase/client";

export interface CheckInResult {
  used_sessions: number;
  max_sessions: number;
  remaining: number;
}

/** 횟수권 출석 1회 차감 */
export async function checkInSession(membershipId: string): Promise<CheckInResult> {
  const { data, error } = await supabase.rpc("check_in_session", {
    _membership_id: membershipId,
  });
  if (error) {
    // 서버 에러 코드 한국어 변환
    const msg = error.message;
    if (msg.includes("PERMISSION_DENIED"))     throw new Error("권한이 없습니다.");
    if (msg.includes("MEMBERSHIP_NOT_FOUND"))  throw new Error("이용권을 찾을 수 없습니다.");
    if (msg.includes("NOT_ACTIVE"))            throw new Error("활성 이용권이 아닙니다.");
    if (msg.includes("NOT_SESSION_BASED"))     throw new Error("횟수권이 아닌 이용권입니다.");
    if (msg.includes("NO_SESSIONS_LEFT"))      throw new Error("남은 횟수가 없습니다.");
    throw new Error(msg);
  }
  return data as CheckInResult;
}

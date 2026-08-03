import { supabase } from "@/integrations/supabase/client";

/**
 * 일일 경영 리포트 자동 집계 — 브로제이 명부 기준 (Workers 경유)
 *
 * 검수 반영(boxing): 회원 현황(활성·만료예정·신규)은 브로제이가 원본 원장이라
 * 153OS 자체 테이블로 세면 브로제이 화면과 숫자가 갈라진다. 집계는 워커
 * GET /api/reports/auto-stats 가 member_snapshots(브로제이 동기화 명부)로 계산한다.
 * - 출입: access_logs (153OS 고유)
 * - 활성/만료예정/신규: member_snapshots (브로제이)
 * - 미납: members.status (CRM 수기 처리 — 브로제이엔 미납 개념 없음)
 */
export interface ReportAutoStats {
  accessSuccess: number;   // 해당일 출입 성공
  accessDenied: number;    // 해당일 출입 거절
  newMembers: number;      // 해당일 신규 등록 (브로제이 가입일 기준)
  expiringSoon: number;    // 오늘 기준 7일 내 만료 예정 (브로제이 만료일 기준)
  unpaid: number;          // 미납 회원 (CRM 수기 처리 기준)
  activeMembers: number;   // 활성 회원 수 (브로제이 기준)
}

const baseUrl = import.meta.env.VITE_API_BASE_URL as string;

/**
 * 통합 자동 집계 — 홈 대시보드·출입 현황·일일 리포트가 전부 이 함수를 쓴다(숫자 단일 출처).
 * branchId 생략: 본사 계정 = 전 지점 합계, 지점 계정 = 자기 지점 (워커가 판정).
 */
export async function getAutoStats(
  opts: { branchId?: string | null; date?: string } = {}
): Promise<ReportAutoStats> {
  const params = new URLSearchParams();
  if (opts.branchId) params.set("branch_id", opts.branchId);
  if (opts.date) params.set("date", opts.date);
  const qs = params.toString();

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch(
    `${baseUrl}/api/reports/auto-stats${qs ? `?${qs}` : ""}`,
    { headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } }
  );
  const json = (await res.json()) as {
    success: boolean;
    data: ReportAutoStats;
    error?: { message?: string };
    message?: string;
  };
  if (!res.ok || !json.success) {
    throw new Error(json.error?.message ?? json.message ?? `HTTP ${res.status}`);
  }
  return json.data;
}

/** 일일 리포트 화면용 (지점·날짜 지정) */
export function getReportAutoStats(branchId: string, date: string): Promise<ReportAutoStats> {
  return getAutoStats({ branchId, date });
}

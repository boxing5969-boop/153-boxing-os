/**
 * 브로제이(BROJ) 오픈 API 클라이언트 — 읽기 전용 데이터 연동.
 *
 * - 인증: 헤더 `API-KEY: <env.BROJ_API_KEY>` (IP 화이트리스트 없음 → Workers 호환).
 * - 베이스: env.BROJ_API_URL (미설정 시 실서비스 https://api.broj.co.kr).
 * - B1 범위: status() 만. 회원/매출/출석 호출은 다음 Phase(B2~B4)에서 추가한다.
 * - 키(BROJ_API_KEY)는 시크릿. 이 파일은 값을 로깅하지 않는다.
 */
import type { Env } from "../lib/env";

const DEFAULT_BASE = "https://api.broj.co.kr";

/** /v1/status 응답 — API Key 연결 상태·권한·범위·호출한도 */
export interface BrojStatus {
  connected?: boolean;
  key_id?: string;
  grade?: "BRAND" | "CENTER" | string;
  brand_ids?: string[];
  group_ids?: string[];
  permissions?: Record<string, string>;
  status?: "ACTIVE" | "SUSPENDED" | "REVOKED" | string;
  plan_code?: string;
  trial_started_at?: string;
  trial_ends_at?: string;
  monthly_free_quota?: number;
  per_minute_limit?: number;
  expired_at?: string;
}

/** BROJ 호출 실패 — HTTP status 를 보존해 상위에서 사유 표기 */
export class BrojError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "BrojError";
  }
}

function baseUrl(env: Env): string {
  const u = (env.BROJ_API_URL ?? "").trim();
  return (u ? u : DEFAULT_BASE).replace(/\/+$/, "");
}

/** 키가 설정돼 있는지 (라이브 호출 전 가드) */
export function hasBrojKey(env: Env): boolean {
  return !!(env.BROJ_API_KEY && env.BROJ_API_KEY.trim());
}

/** 공통 GET — 플랫 쿼리파라미터(group_id, limit, cursor…) + API-KEY 헤더 */
async function brojGet<T>(
  env: Env,
  path: string,
  query?: Record<string, string | number | boolean | undefined | null>
): Promise<T> {
  if (!hasBrojKey(env)) throw new BrojError(0, "BROJ_API_KEY 미설정");
  const url = new URL(baseUrl(env) + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "GET",
      headers: { "API-KEY": env.BROJ_API_KEY as string, Accept: "application/json" },
    });
  } catch (e) {
    throw new BrojError(0, `BROJ 연결 실패: ${e instanceof Error ? e.message : "network"}`);
  }
  const text = await res.text();
  if (res.status === 429) throw new BrojError(429, "BROJ 호출 한도 초과(분당 제한). 잠시 후 재시도.");
  if (!res.ok) throw new BrojError(res.status, `BROJ ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new BrojError(res.status, "BROJ 응답 JSON 파싱 실패");
  }
}

/** API Key 상태 조회 — 연결/등급/접근 지점/호출한도 확인 (파라미터 없음) */
export function brojStatus(env: Env): Promise<BrojStatus> {
  return brojGet<BrojStatus>(env, "/v1/status");
}

/** 센터(지점) 목록 — 우리 branch 와 매칭할 group_id 확인용 */
export interface BrojGroup {
  group_id?: string;
  group_name?: string;
  phone_number?: string;
  region?: string;
  [k: string]: unknown;
}
export function brojGroups(env: Env, opts?: { brand_id?: string; group_id?: string }): Promise<BrojGroup[]> {
  return brojGet<BrojGroup[]>(env, "/v1/groups", { brand_id: opts?.brand_id, group_id: opts?.group_id });
}

/** 회원 목록 (커서 페이지네이션). limit 최대 200. */
export interface BrojMember {
  group_id?: string;
  member_id?: string;
  name?: string;
  phone_number?: string;
  sex?: string;
  authority?: string;
  birth_date?: number;       // ms timestamp
  email?: string;
  attendance_number?: number;
  agree_advertisement?: boolean;
  remarks?: string;
  remain_mileage?: number;
  classification?: string;
  visit_route?: string;
  exercise_purpose?: string;
  created_at?: number;       // ms timestamp
  [k: string]: unknown;
}
export interface BrojMemberPage {
  data?: BrojMember[];
  pagination?: { limit?: number; has_next?: boolean; next_cursor?: string };
}
export function brojMembers(
  env: Env,
  opts: { group_id?: string; brand_id?: string; limit?: number; cursor?: string; keyword?: string }
): Promise<BrojMemberPage> {
  return brojGet<BrojMemberPage>(env, "/v1/members", {
    group_id: opts.group_id, brand_id: opts.brand_id,
    limit: opts.limit ?? 200, cursor: opts.cursor, keyword: opts.keyword,
  });
}

/**
 * 회원 이용권(회원권 요약 + 수업권·대여권). GET /v1/groups/{gid}/members/{member_id}/tickets
 * 회원 목록엔 만료일이 없어 이 API 로만 확인 가능 — 회원당 1콜이므로 배치로 나눠 호출한다.
 */
export interface BrojMemberTickets {
  group_id?: string;
  member_id?: string;
  membership_summary?: {
    start_at?: string;   // YYYY-MM-DD
    end_at?: string;     // YYYY-MM-DD (이용권 만료일)
    left_days?: number;
    total_days?: number;
    status?: "ACTIVE" | "INACTIVE" | "SOON_ACTIVE" | "SOON_INACTIVE" | "HOLDING" | "UNKNOWN" | string;
    tickets?: {
      name?: string; start_at?: string; end_at?: string; ticket_status?: string;
      /** 홀딩(일시정지) — 추정이 아니라 브로제이 원본 값 */
      has_holding_period?: boolean;
      holding_start_at?: string;   // YYYY-MM-DD
      holding_end_at?: string;     // YYYY-MM-DD
    }[];
  };
  lesson_ticket_groups?: unknown[];
  rental_ticket_groups?: unknown[];
  [k: string]: unknown;
}
export function brojMemberTickets(
  env: Env,
  opts: { group_id: string; member_id: string; include_expired?: boolean }
): Promise<BrojMemberTickets> {
  return brojGet<BrojMemberTickets>(
    env,
    `/v1/groups/${encodeURIComponent(opts.group_id)}/members/${encodeURIComponent(opts.member_id)}/tickets`,
    { include_expired: opts.include_expired ? "true" : undefined }
  );
}

/**
 * 출석(출입) 이력. GET /v1/attendance/histories
 *
 * ⚠️ 다른 목록 API 와 달리 **커서가 아니라 page_index 오프셋 방식**이고, 응답에 pagination 이 없다.
 *    → data.length < size 이면 마지막 페이지로 판단해야 한다.
 */
export interface BrojAttendanceItem {
  attendance_id?: string;
  attendance_type?: "ENTRY" | "CLASS" | "FACILITY" | "GO_TO_WORK" | string;
  member_id?: string;
  name?: string;
  phone?: string;
  attendance_status?: "SUCCESS" | "FAILURE" | "SHOW" | "NO_SHOW" | string;
  attendance_date?: string;   // 출석 일시
  exit_date?: string;
  group_id?: string;
  member_type?: "CUSTOMER" | "ADMIN" | "ALL" | string;
  device_name?: string;
  failure_reason?: string;
  ticket_info?: {
    ticket_id?: string;
    name?: string;
    type?: string;
    total_count?: number;
    remain_count?: number;
    start_date?: string;
    expire_date?: string;
  };
  [k: string]: unknown;
}
export interface BrojAttendancePage {
  data?: BrojAttendanceItem[];
}
export function brojAttendance(
  env: Env,
  opts: {
    group_id?: string; brand_id?: string;
    start_date: string; end_date: string;
    size?: number; page_index?: number;
    member_type?: "ALL" | "CUSTOMER" | "ADMIN";
    /**
     * ⚠️ 필수. 빼면 400. 한 번에 한 값만 받는다 — 여러 상태가 필요하면 호출을 나눈다.
     * 허용 값이 브로제이 쪽에서 바뀐다(2026-07 기준 ALL/SUCCESS/FAILURE, 예전 SHOW 는 이제 400).
     * 호출부(brojSync)에서 거부된 값을 건너뛰도록 처리하므로 여기서는 넓게 받는다.
     */
    attendance_status: "ALL" | "SUCCESS" | "FAILURE" | "SHOW" | "NO_SHOW";
  }
): Promise<BrojAttendancePage> {
  return brojGet<BrojAttendancePage>(env, "/v1/attendance/histories", {
    group_id: opts.group_id, brand_id: opts.brand_id,
    start_date: opts.start_date, end_date: opts.end_date,
    size: opts.size ?? 200,
    page_index: opts.page_index ?? 0,
    // 직원 출근(GO_TO_WORK)·관리자 기록은 회원 방문 통계에서 제외
    member_type: opts.member_type ?? "CUSTOMER",
    // ⚠️ 조회량이 일정 규모를 넘으면 BROJ 가 이 필터를 필수로 요구한다
    //    (미지정 시 400 "attendance_status must be one of [...]").
    //    한 번에 한 값만 받으므로 여러 상태가 필요하면 호출을 나눠야 한다.
    attendance_status: opts.attendance_status,
  });
}

/** 상품 매출 내역 (커서 페이지네이션). GET /v1/groups/{group_id}/sales/history/products */
export interface BrojProductHistory {
  paid_at?: string;            // 결제 일시 (date-time)
  history_type?: "UNKNOWN" | "PAYMENT" | "OUTSTANDING_PAYMENT" | "REFUND" | "REPAID" | string;
  product_name?: string;
  customer_name?: string;
  sales_tag_name?: string;
  product_type?:
    | "UNKNOWN" | "MEMBERSHIP" | "RESERVATION_TICKET" | "ENTRY_TICKET" | "FACILITY_TICKET"
    | "LOCKER_TICKET" | "RENTAL_TICKET" | "NORMAL_PRODUCT" | "ETC_SALES" | string;
  sales_manager_name?: string;
  product_total_payment_price?: number;
  total_payment_price?: number;
  cash_price?: number;
  card_price?: number;
  payment_channel?: string;    // money/card/mix/wiretransfer/naver/kakaopay/…
  memo?: string;
  [k: string]: unknown;
}
export interface BrojSalesPage {
  data?: BrojProductHistory[];
  pagination?: { limit?: number; has_next?: boolean; next_cursor?: string };
}
export async function brojSalesHistory(
  env: Env,
  opts: { group_id: string; start_date: string; end_date: string; page_size?: number; cursor?: string }
): Promise<BrojSalesPage> {
  const path = `/v1/groups/${encodeURIComponent(opts.group_id)}/sales/history/products`;
  const base = {
    start_date: opts.start_date, end_date: opts.end_date,
    page_size: opts.page_size ?? 200, cursor: opts.cursor, sort_by: "PAID_AT", sort_type: "ASC",
  };
  // ⚠️ 기본값은 단말기(카드) 결제만 내려주는 센터가 있어 types/payment_method_types=ALL 를 우선 시도.
  //    일부 센터는 이 조합에서 BROJ가 500을 반환 → 파라미터를 단계적으로 줄여 재시도(폴백).
  const attempts: Record<string, string | number | undefined>[] = [
    { ...base, types: "ALL", payment_method_types: "ALL" },
    { ...base, types: "ALL" },
    { ...base },
  ];
  let lastErr: unknown;
  for (const q of attempts) {
    try {
      return await brojGet<BrojSalesPage>(env, path, q);
    } catch (e) {
      lastErr = e;
      // 4xx(권한·파라미터 오류)면 폴백 의미 없음 — 즉시 중단. 5xx·네트워크만 재시도.
      if (e instanceof BrojError && e.status >= 400 && e.status < 500) throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new BrojError(0, "BROJ 매출 조회 실패");
}

/** [임시 진단용] 임의 추가 파라미터로 매출 조회 — 어떤 필터가 전체 매출을 주는지 비교용. */
export function brojSalesRaw(
  env: Env,
  opts: { group_id: string; start_date: string; end_date: string; page_size?: number; cursor?: string },
  extra?: Record<string, string | number | undefined>
): Promise<BrojSalesPage> {
  return brojGet<BrojSalesPage>(env, `/v1/groups/${encodeURIComponent(opts.group_id)}/sales/history/products`, {
    start_date: opts.start_date, end_date: opts.end_date,
    page_size: opts.page_size ?? 200, cursor: opts.cursor, sort_by: "PAID_AT", sort_type: "ASC",
    ...(extra ?? {}),
  });
}

/**
 * 브로제이(BROJ) 데이터 → 153 경영 리포트 동기화 (B3: 매출).
 *
 * syncSales(): /v1/groups/{gid}/sales/history/products 를 커서로 전 페이지 훑어
 *   ① sales_entries(라인별, source='broj') 를 기간분 삭제→재삽입 (멱등)
 *   ② daily_reports(일자별)에 매출 필드만 병합 SET (수기 항목 보존, 멱등)
 *   ③ import_jobs 에 실행 기록
 *
 * 원칙: BROJ 가 매출의 원본. 재동기화해도 결과 동일(SET/재삽입). REFUND 는 음수 반영,
 *   OUTSTANDING_PAYMENT/UNKNOWN(미수·불명)은 실입금이 아니라 제외.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../lib/env";
import { brojSalesHistory, brojMembers, brojAttendance, brojMemberTickets, type BrojProductHistory, type BrojMember } from "./brojClient";

const MEMBERSHIP_TYPES = new Set(["MEMBERSHIP", "RESERVATION_TICKET", "ENTRY_TICKET", "FACILITY_TICKET"]);
const GOODS_TYPES = new Set(["LOCKER_TICKET", "RENTAL_TICKET", "NORMAL_PRODUCT"]);

/** product_type → sales_entries.category(표시) + daily_reports 버킷 */
function classify(pt?: string): { category: string; bucket: "membership" | "goods" } {
  if (pt && MEMBERSHIP_TYPES.has(pt)) return { category: "수강권", bucket: "membership" };
  if (pt && GOODS_TYPES.has(pt)) return { category: "물품", bucket: "goods" };
  return { category: "기타", bucket: "goods" };
}

/** 결제 채널 → 결제수단(현금/카드/계좌이체) */
function payMethod(ch?: string, cash?: number, card?: number): string {
  switch (ch) {
    case "money": return "현금";
    case "wiretransfer": return "계좌이체";
    case "mix": return (card ?? 0) >= (cash ?? 0) ? "카드" : "현금";
    default: return "카드"; // card·naver·kakaopay·zeropay·everyfit·ngym·unknown 등 전자결제
  }
}

/** history_type → 부호(+매출 / -환불 / 0 제외) */
function sign(ht?: string): 1 | -1 | 0 {
  if (ht === "PAYMENT" || ht === "REPAID") return 1;
  if (ht === "REFUND") return -1;
  return 0; // OUTSTANDING_PAYMENT(미수)·UNKNOWN 제외
}

interface SalesEntryRow {
  branch_id: string;
  sale_date: string;
  member_name: string;
  category: string;
  product: string;
  is_new: boolean;
  payment_method: string;
  amount: number;
  source: string;
}
interface DayAgg { membership: number; goods: number; refund: number; refundCount: number }

/** ms 또는 문자열 일시 → KST 기준 { iso, date } */
function toKst(v: unknown): { iso: string | null; date: string | null } {
  if (v == null || v === "") return { iso: null, date: null };
  const n = typeof v === "number" ? v : Number(v);
  const t = Number.isFinite(n) && String(v).length >= 10 && !String(v).includes("-")
    ? new Date(n)
    : new Date(String(v));
  if (Number.isNaN(t.getTime())) return { iso: null, date: null };
  return {
    iso: t.toISOString(),
    date: new Date(t.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10),
  };
}

export interface SyncAttendanceResult {
  ok: true;
  branch_id: string;
  from: string;
  to: string;
  pages: number;
  fetched: number;
  written: number;
  /** 호출 예산이 다 떨어져 중간에 끊겼는가 — true 면 다시 실행해 이어받아야 한다 */
  truncated?: boolean;
  /** 이번에 쓴 브로제이 호출 수(서브리퀘스트 예산 배분용) */
  calls?: number;
}

/**
 * 브로제이 출석(출입) 이력 → attendance_logs 동기화.
 *
 * ⚠️ 이 API 는 커서가 아니라 page_index 오프셋이고 응답에 pagination 이 없다.
 *    data.length < size 이면 마지막 페이지로 판단한다.
 * 재실행해도 (branch_id, broj_attendance_id) unique 로 중복되지 않는다(upsert).
 */
export async function syncAttendance(
  db: SupabaseClient,
  env: Env,
  opts: { branchId: string; groupId: string; from: string; to: string; maxCalls?: number },
): Promise<SyncAttendanceResult> {
  const { branchId, groupId, from, to } = opts;
  const SIZE = 200;
  const MAX_PAGES = 60;          // 안전 상한 = 12,000건
  // ⚠️ 워커 1회 실행의 **서브리퀘스트 한도**(무료 플랜 50)가 진짜 상한이다.
  //    '최근 6개월'은 지점 하나가 20~30페이지라 한도를 그냥 넘겨 통째로 죽는다.
  //    호출 수를 세다가 예산을 넘기면 거기서 멈추고 truncated 로 알린다 — 나머지는 다음 실행에서.
  const maxCalls = Math.max(opts.maxCalls ?? 60, 2);
  let calls = 0;
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>(); // 같은 배치 안 중복 id 방어(upsert 는 배치 내 중복을 못 거른다)
  let pages = 0, fetched = 0;

  // ⚠️ 브로제이 출석 조회 제약 (문서에 없음 — 실측으로 확인)
  //    ① 조회 기간은 한 번에 **90일 이내**여야 한다 ("search range cannot exceed 90 days")
  //    ② attendance_status 는 **필수**이고 한 번에 한 값만 받는다.
  //    ③ 허용 값이 브로제이 쪽에서 바뀐다. 2026-07 기준 [ALL, SUCCESS, FAILURE] 이고,
  //       그 전에 쓰던 SHOW 는 이제 400 을 낸다. 그래서 후보를 순서대로 시도하고,
  //       '지원하지 않는 값'이면 그 값만 건너뛴다. 값 하나 때문에 동기화 전체가 실패하면 안 된다.
  //       ※ ALL 은 쓰지 않는다 — 거절된 출입(FAILURE)까지 섞여 출석 수가 부풀려진다.
  const windows: { from: string; to: string }[] = [];
  {
    const WINDOW = 80;   // 90일 한도에 여유를 둔다
    const start = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T00:00:00Z`);
    for (let s = start; s <= end; s += (WINDOW + 1) * 86400000) {
      const e = Math.min(s + WINDOW * 86400000, end);
      windows.push({
        from: new Date(s).toISOString().slice(0, 10),
        to: new Date(e).toISOString().slice(0, 10),
      });
    }
  }

  // 지원하지 않는다고 판명된 상태값 — 한 번 걸리면 이후 창(window)에서 다시 시도하지 않는다.
  const unsupported = new Set<string>();
  const isUnsupportedStatus = (e: unknown): boolean =>
    e instanceof Error && /attendance_status must be one of/i.test(e.message);

  let truncated = false;
  outer:
  for (const w of windows) {
  for (const status of ["SUCCESS", "SHOW"] as const) {
    if (unsupported.has(status)) continue;
    for (let page = 0; page < MAX_PAGES; page++) {
      if (calls >= maxCalls) { truncated = true; break outer; }   // 예산 소진 — 여기까지만
      calls += 1;
      let res: Awaited<ReturnType<typeof brojAttendance>>;
      try {
        res = await brojAttendance(env, {
          group_id: groupId, start_date: w.from, end_date: w.to, size: SIZE, page_index: page,
          attendance_status: status,
        });
      } catch (e) {
        if (isUnsupportedStatus(e)) { unsupported.add(status); break; }  // 이 값은 포기, 나머지는 계속
        throw e;
      }
      const list = res.data ?? [];
      pages += 1;
      fetched += list.length;

      for (const a of list) {
        const id = a.attendance_id;
        if (!id || seen.has(id)) continue;   // 상태별 조회 간 중복도 여기서 걸러진다
        seen.add(id);
        const at = toKst(a.attendance_date);
        if (!at.date) continue;    // 날짜 없는 기록은 집계 불가 — 저장하지 않는다
        const exp = toKst(a.ticket_info?.expire_date);
        rows.push({
          branch_id: branchId,
          broj_attendance_id: id,
          broj_member_id: a.member_id ?? null,
          member_name: a.name ?? null,
          phone: a.phone ?? null,
          attended_at: at.iso,
          attend_date: at.date,
          attendance_type: a.attendance_type ?? null,
          attendance_status: a.attendance_status ?? status,
          ticket_name: a.ticket_info?.name ?? null,
          ticket_type: a.ticket_info?.type ?? null,
          remain_count: a.ticket_info?.remain_count ?? null,
          ticket_expire_date: exp.date,
          device_name: a.device_name ?? null,
        });
      }
      if (list.length < SIZE) break;   // 마지막 페이지
    }
  }
  }

  // 500행씩 upsert (Workers 서브리퀘스트 한도)
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await db
      .from("attendance_logs")
      .upsert(chunk, { onConflict: "branch_id,broj_attendance_id" });
    if (error) throw new Error(`출석 저장 실패: ${error.message}`);
    written += chunk.length;
  }

  return { ok: true, branch_id: branchId, from, to, pages, fetched, written, truncated, calls };
}

export interface SyncHoldResult {
  ok: true;
  checked: number;
  holding: number;
  failed: number;
  /** 아직 조회하지 않은 회원 수 — 0이 되면 한 바퀴 완료 */
  remaining: number;
}

/**
 * 홀딩(일시정지) 동기화 — 회원별 이용권 API 의 **원본 값**을 가져온다.
 *
 * ⚠️ 회원 한 명당 1회 호출이라 비싸다. 그래서:
 *   · 한 번에 batch 명만 처리하고, '마지막 조회가 가장 오래된 회원'부터 돈다.
 *   · 분당 60회 제한이 있어 batch 기본값을 50 으로 둔다.
 *   · 자동 동기화가 매일 조금씩 돌면 며칠 안에 전원이 한 바퀴 갱신된다.
 *
 * 역산 추정(상품기간 vs 종료일)은 폐기했다 — 락커·부가상품 종료일이 섞여 신뢰할 수 없었다.
 */
export async function syncMemberHolds(
  db: SupabaseClient,
  env: Env,
  opts: { branchId: string; groupId: string; batch?: number },
): Promise<SyncHoldResult> {
  const { branchId, groupId } = opts;
  const batch = Math.min(Math.max(opts.batch ?? 50, 1), 120);
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

  // 조회 대상: 유효회원 + **end_date 없는 회원**(41명 실측 — 홀딩으로 연장 중이면 만료일이 비거나
  // 지나 있을 수 있다. gte 만 쓰면 이들이 영원히 미조회로 남아 브로제이 홀딩 5명 vs 앱 3명이 어긋났다).
  // + 최근 24시간 안에 본 회원은 건너뛴다(스윕이 매시간 돌면서 방금 본 회원을 또 보던 낭비 16.6% 실측).
  const fresh = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data, error } = await db
    .from("member_snapshots")
    .select("id, member_name, raw_payload, ticket_checked_at")
    .eq("branch_id", branchId)
    .or(`end_date.gte.${today},end_date.is.null,hold_status.eq.HOLDING`)
    .or(`ticket_checked_at.is.null,ticket_checked_at.lt.${fresh}`)
    .order("ticket_checked_at", { ascending: true, nullsFirst: true })
    .limit(batch);
  if (error) throw new Error(`대상 조회 실패: ${error.message}`);

  const rows = (data as { id: string; member_name: string; raw_payload: Record<string, unknown> | null }[] | null) ?? [];
  let checked = 0, holding = 0, failed = 0;

  for (const r of rows) {
    const mid = String(r.raw_payload?.member_id ?? "");
    if (!mid) { failed += 1; continue; }
    try {
      const t = await brojMemberTickets(env, { group_id: groupId, member_id: mid });
      const tickets = t.membership_summary?.tickets ?? [];
      // 홀딩이 걸린 이용권 중 가장 늦게 끝나는 것을 대표로 본다
      const held = tickets
        .filter((x) => x.has_holding_period && x.holding_end_at)
        .sort((a, b) => String(b.holding_end_at).localeCompare(String(a.holding_end_at)))[0];
      const status = held ? "HOLDING" : (t.membership_summary?.status ?? null);
      if (held) holding += 1;
      await db.from("member_snapshots").update({
        hold_status: status,
        hold_start: held?.holding_start_at ?? null,
        hold_end: held?.holding_end_at ?? null,
        ticket_checked_at: new Date().toISOString(),
      }).eq("id", r.id);
      checked += 1;
    } catch (e) {
      failed += 1;
      // 실패해도 조회 시각은 남겨 같은 회원에서 막히지 않게 한다
      await db.from("member_snapshots").update({ ticket_checked_at: new Date().toISOString() }).eq("id", r.id);
      console.error("[broj] tickets", r.member_name, e instanceof Error ? e.message : e);
    }
  }

  // 아직 안 본 회원 수 (오늘 갱신되지 않은 유효회원)
  const since = new Date(Date.now() - 6 * 86400000).toISOString();
  const { count } = await db.from("member_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("branch_id", branchId)
    .or(`end_date.gte.${today},end_date.is.null,hold_status.eq.HOLDING`)
    .or(`ticket_checked_at.is.null,ticket_checked_at.lt.${since}`);

  return { ok: true, checked, holding, failed, remaining: count ?? 0 };
}

/**
 * 출석 기록의 이용권 정보로 회원 명부 보강
 *  ① 잔여 횟수(횟수제) ② 비어 있던 만료일 채우기
 */
export async function refreshTicketStats(
  db: SupabaseClient,
  branchId?: string | null,
): Promise<{ sessions: number; expiry: number }> {
  const { data, error } = await db.rpc("broj_refresh_ticket_stats", { _branch_id: branchId ?? null });
  if (error) throw new Error(error.message);
  const rows = (data as { branch_id: string; sessions_filled: number; expiry_filled: number }[] | null) ?? [];
  return {
    sessions: rows.reduce((a, r) => a + (r.sessions_filled ?? 0), 0),
    expiry: rows.reduce((a, r) => a + (r.expiry_filled ?? 0), 0),
  };
}

/** 출석 이력 → 회원별 방문 빈도(7/30/90일) + 마지막 방문일 갱신 */
export async function refreshAttendanceStats(
  db: SupabaseClient,
  branchId?: string | null,
): Promise<{ updated: number }> {
  const { data, error } = await db.rpc("broj_refresh_attendance_stats", { _branch_id: branchId ?? null });
  if (error) throw new Error(error.message);
  const rows = (data as { branch_id: string; updated: number }[] | null) ?? [];
  return { updated: rows.reduce((a, r) => a + (r.updated ?? 0), 0) };
}

/**
 * 브로제이 매출에서 회원별 '최근 수강권 결제금액'을 member_snapshots.payment_amount 로 채운다.
 * 환불계산기의 회원 검색 자동채움이 이 값을 쓴다.
 * 회원 동기화가 명부를 갈아끼우면 결제금액이 비므로, 동기화 직후 항상 이걸 돌려 다시 채운다.
 */
export async function fillPaymentAmounts(
  db: SupabaseClient,
  branchId?: string | null,
): Promise<{ filled: number; branches: { branch_id: string; filled: number }[] }> {
  const { data, error } = await db.rpc("broj_fill_payment_amounts", { _branch_id: branchId ?? null });
  if (error) throw new Error(error.message);
  const rows = (data as { branch_id: string; filled: number }[] | null) ?? [];
  return { filled: rows.reduce((a, r) => a + (r.filled ?? 0), 0), branches: rows };
}

export interface SyncSalesResult {
  ok: true;
  branch_id: string;
  from: string;
  to: string;
  pages: number;
  rows_seen: number;
  lines_written: number;
  days: number;
  sales_total: number;
  refund_total: number;
  job_id: string | null;
}

/** 브로제이 매출 → sales_entries + daily_reports 동기화 */
export async function syncSales(
  db: SupabaseClient,
  env: Env,
  opts: { branchId: string; groupId: string; from: string; to: string; createdBy?: string | null }
): Promise<SyncSalesResult> {
  const { branchId, groupId, from, to, createdBy } = opts;

  // 1) 전 페이지 수집 (커서, 안전 상한 60페이지 = 12,000행)
  const rows: BrojProductHistory[] = [];
  let cursor: string | undefined;
  let pages = 0;
  const MAX_PAGES = 60;
  do {
    const page = await brojSalesHistory(env, { group_id: groupId, start_date: from, end_date: to, page_size: 200, cursor });
    for (const r of page.data ?? []) rows.push(r);
    cursor = page.pagination?.has_next ? page.pagination?.next_cursor : undefined;
    pages += 1;
  } while (cursor && pages < MAX_PAGES);

  // 2) 라인 + 일자별 집계
  const lines: SalesEntryRow[] = [];
  const byDay = new Map<string, DayAgg>();
  let salesTotal = 0;
  let refundTotal = 0;

  for (const r of rows) {
    const s = sign(r.history_type);
    if (s === 0) continue;
    const date = (r.paid_at ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const amt = Math.abs(Math.round(r.total_payment_price ?? 0));
    if (amt === 0) continue;
    const { category, bucket } = classify(r.product_type);
    const signed = s * amt;

    lines.push({
      branch_id: branchId,
      sale_date: date,
      member_name: (r.customer_name ?? "").trim() || "비회원",
      category,
      product: (r.product_name ?? "").trim() || category,
      is_new: true, // BROJ 매출행엔 신규/재등록 표식 없음 → 기본 신규(정확 분류는 B3.1)
      payment_method: payMethod(r.payment_channel, r.cash_price, r.card_price),
      amount: signed,
      source: "broj",
    });

    const agg = byDay.get(date) ?? { membership: 0, goods: 0, refund: 0, refundCount: 0 };
    if (s < 0) { agg.refund += amt; agg.refundCount += 1; refundTotal += amt; }
    else { if (bucket === "membership") agg.membership += amt; else agg.goods += amt; salesTotal += amt; }
    byDay.set(date, agg);
  }

  // 3) sales_entries: 기간 내 broj 분 삭제 후 재삽입 (멱등)
  // ⚠️ 회원 명부와 같은 원칙 — **먼저 쓰고, 나중에 지운다**.
  //    delete 를 앞에 두면 insert 가 한 번 실패했을 때 그 기간 매출이 0으로 남는다(역삼점 회원 사고와 같은 구조).
  //    워커가 네트워크·타임아웃으로 중간에 죽은 이력이 실제로 있어 가정이 아니다.
  const { data: oldRows } = await db.from("sales_entries")
    .select("id").eq("branch_id", branchId).eq("source", "broj")
    .gte("sale_date", from).lte("sale_date", to)
    .order("id", { ascending: true }).limit(20000);
  const oldIds = ((oldRows as { id: string }[] | null) ?? []).map((r) => r.id);

  for (let i = 0; i < lines.length; i += 500) {
    const chunk = lines.slice(i, i + 500);
    const { error } = await db.from("sales_entries").insert(chunk);
    if (error) throw new Error(`sales_entries 삽입 실패: ${error.message}`);
  }
  // 새 줄이 다 들어간 뒤에야 옛 줄을 지운다(잠깐 중복이 있어도 0이 되는 것보다 낫다)
  for (let i = 0; i < oldIds.length; i += 100) {
    const { error } = await db.from("sales_entries").delete().in("id", oldIds.slice(i, i + 100));
    if (error) { console.error(`[syncSales] 옛 매출 정리 실패: ${error.message}`); break; }
  }

  // 4) daily_reports: 일자별 매출 필드만 SET (수기 항목 보존, 멱등)
  //    ⚠️ 날짜별 개별 UPDATE 는 Cloudflare Workers 서브리퀘스트 한도를 넘김(지점 여러 곳 순차 처리 시).
  //    (branch_id, report_date) 유니크 제약을 이용해 upsert 1회로 처리 — payload 에 담은 매출 필드만 갱신되고
  //    출석·문의·가입 등 수기 입력 컬럼은 기존 값이 보존된다.
  const dates = [...byDay.keys()];
  if (dates.length) {
    const rows = [...byDay.entries()].map(([date, a]) => ({
      branch_id: branchId, report_date: date,
      revenue_membership: a.membership, revenue_goods: a.goods,
      refund_amount: a.refund, refund_count: a.refundCount,
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db.from("daily_reports")
        .upsert(rows.slice(i, i + 200), { onConflict: "branch_id,report_date" });
      if (error) throw new Error(`daily_reports 갱신 실패: ${error.message}`);
    }
  }

  // 5) 실행 기록
  let jobId: string | null = null;
  const { data: job } = await db.from("import_jobs").insert({
    branch_id: branchId, import_type: "broj_sales", file_name: `BROJ 매출 ${from}~${to}`,
    status: "success", total_rows: rows.length, imported_rows: lines.length, failed_rows: 0,
    created_by: createdBy ?? null, completed_at: new Date().toISOString(),
  }).select("id").maybeSingle();
  jobId = (job as { id: string } | null)?.id ?? null;

  return {
    ok: true, branch_id: branchId, from, to, pages, rows_seen: rows.length,
    lines_written: lines.length, days: dates.length,
    sales_total: salesTotal, refund_total: refundTotal, job_id: jobId,
  };
}

// ── B2: 회원 명부 동기화 ─────────────────────────────────────
//
// 브로제이 /v1/members 는 회원권 기간·최근출석까지 함께 준다(회원당 개별 조회 불필요):
//   total_member_ticket_start_at / _end_at (ms) · last_attendance_date (ms)
// 이를 member_snapshots 로 옮겨 회원관리·재등록·휴면 판정의 원본으로 삼는다.

/** ms 타임스탬프 → KST 기준 YYYY-MM-DD (없으면 null) */
function msToDate(ms: unknown): string | null {
  const n = typeof ms === "number" ? ms : Number(ms);
  if (!n || !Number.isFinite(n) || n <= 0) return null;
  return new Date(n + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
/** 숫자만 남긴 전화번호 (매칭 키) */
function normPhone(p: unknown): string {
  return String(p ?? "").replace(/\D/g, "");
}
/** 회원권 종료일 기준 상태 라벨 (앱 전반이 한글 상태를 쓴다) */
function memberStatus(endDate: string | null, today: string): string {
  if (!endDate) return "미상";
  return endDate >= today ? "유효" : "만료";
}

// ⚠️ normalized_phone 은 DB 생성 컬럼(phone 에서 자동 계산) — insert 에 포함하면 안 된다.
interface SnapshotRow {
  /**
   * 항상 채운다. 기존 회원이면 종전 id 재사용(전체 교체에도 id 불변 → 발송·케어 이력 링크 보존),
   * 신규면 코드에서 uuid 발급. **선택 필드로 두면 안 된다** — 아래 insert 주석 참고.
   */
  id: string;
  branch_id: string;
  member_name: string;
  phone: string | null;
  product_name: string | null;
  membership_type: string | null;
  start_date: string | null;
  end_date: string | null;
  latest_visit_date: string | null;
  payment_amount: number | null;
  status: string | null;
  source: string;
  raw_payload: Record<string, unknown>;
}

export interface SyncMembersResult {
  ok: true;
  branch_id: string;
  pages: number;
  fetched: number;
  written: number;
  active: number;
  expired: number;
  with_end_date: number;
  kept_payment: number;
  /** 같은 전화번호 중복 등록으로 합쳐진 건수 */
  merged: number;
  job_id: string | null;
}

/**
 * 브로제이 회원 → member_snapshots 전체 교체(브로제이가 원본).
 * 기존 행의 payment_amount(엑셀로 채워둔 결제금액)는 전화번호로 매칭해 보존한다.
 */
export async function syncMembers(
  db: SupabaseClient,
  env: Env,
  opts: { branchId: string; groupId: string; createdBy?: string | null }
): Promise<SyncMembersResult> {
  const { branchId, groupId, createdBy } = opts;
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

  // 1) 전 회원 수집 (200명씩 커서, 안전 상한 40페이지 = 8,000명)
  const members: BrojMember[] = [];
  let cursor: string | undefined;
  let pages = 0;
  const MAX_PAGES = 40;
  do {
    const page = await brojMembers(env, { group_id: groupId, limit: 200, cursor });
    for (const m of page.data ?? []) members.push(m);
    cursor = page.pagination?.has_next ? page.pagination?.next_cursor : undefined;
    pages += 1;
  } while (cursor && pages < MAX_PAGES);
  // 페이지 상한에 걸려 끊겼는가 — 목록이 불완전하면 '없는 회원 = 탈퇴'로 볼 수 없다(아래 4-2 안전장치).
  const incomplete = !!cursor;

  // 2) 기존 결제금액 + **기존 id** 보존용 맵 (전화번호 → 값)
  //    ⚠️ id 보존은 필수다. 아래 4)에서 지점 명부를 전체 교체(delete+insert)하는데,
  //    id를 새로 만들면 매일 밤 회원 id가 바뀌어 automation_dispatch_log 의 중복방지 키
  //    (branch, member_id, kind, step, channel)가 무력화된다 → 페이스하락 30일 쿨다운·
  //    주간안부 14일 간격/3회 상한이 전부 풀려 같은 회원에게 매일 문자가 나갈 수 있다.
  //    같은 사람(=같은 번호)은 같은 id를 유지해 케어 이력·발송 이력 링크를 지킨다.
  const paidByPhone = new Map<string, number>();
  const idByPhone = new Map<string, string>();
  const existingIds = new Set<string>();   // 이번에 안 들어온 회원을 나중에 정확히 지우기 위한 기존 id 전체
  {
    // ⚠️ PostgREST 기본 1000행 한도 — 회원이 1000명을 넘는 지점은 뒷부분 id가 안 잡혀
    //    "기존 회원인데 신규로 인식" → id 재발급 → 발송 중복방지가 깨진다. 전량을 페이지네이션으로 읽는다.
    for (let off = 0; off < 20000; off += 1000) {
      const { data, error } = await db.from("member_snapshots")
        .select("id, normalized_phone, payment_amount").eq("branch_id", branchId)
        // ⚠️ order 없는 .range() 는 페이지마다 순서가 달라져 행을 건너뛴다(그 사이 UPDATE 가 들어오면 발생).
        //    한 명이라도 누락되면 '기존 회원인데 신규로 인식' → 새 id 발급 → 번호 유니크 위반으로 전량 실패한다.
        .order("id", { ascending: true })
        .range(off, off + 999);
      if (error) throw new Error(`기존 회원 조회 실패: ${error.message}`);
      const arr = (data as { id: string; normalized_phone: string | null; payment_amount: number | null }[] | null) ?? [];
      for (const r of arr) {
        existingIds.add(r.id);
        if (!r.normalized_phone) continue;
        if (r.payment_amount != null) paidByPhone.set(r.normalized_phone, r.payment_amount);
        idByPhone.set(r.normalized_phone, r.id);
      }
      if (arr.length < 1000) break;
    }
  }

  // 3) 매핑 (+ 전화번호 중복 정리)
  //    DB 유니크: (branch_id, normalized_phone) where normalized_phone <> ''
  //    브로제이엔 같은 번호로 여러 건 등록된 회원이 있어(재등록 시 신규 생성 등) 번호당 1명만 남긴다.
  //    우선순위: 이용권 만료일이 더 늦은 쪽 → 없으면 최근 등록.
  const rows: SnapshotRow[] = [];
  const byPhone = new Map<string, number>(); // normalized_phone → rows 인덱스
  let active = 0, expired = 0, withEnd = 0, keptPaid = 0, merged = 0;
  const rank = (r: SnapshotRow): string => `${r.end_date ?? ""}|${r.latest_visit_date ?? ""}`;
  for (const m of members) {
    const name = String(m.name ?? "").trim();
    if (!name) continue;
    const phone = String(m.phone_number ?? "").trim() || null;
    const np = normPhone(phone);
    const startDate = msToDate(m.total_member_ticket_start_at);
    const endDate = msToDate(m.total_member_ticket_end_at);
    const visit = msToDate(m.last_attendance_date);
    const status = memberStatus(endDate, today);
    const paid = np ? paidByPhone.get(np) ?? null : null;

    // 같은 번호가 이미 있으면 그 id를 유지(발송·케어 이력 링크 보존), 신규는 여기서 직접 발급한다.
    //
    // ⚠️ 신규 행에서 id 키를 '빼면' 안 된다 — PostgREST 는 배열 insert 를 한 문장으로 만들면서
    //    **모든 행의 키를 합집합**으로 맞추고, 없는 키에는 DEFAULT 가 아니라 NULL 을 넣는다.
    //    그래서 id 있는 행과 없는 행이 섞이면 통째로 `null value in column "id"` 로 실패한다.
    //    (2026-08-02 역삼·선릉 회원 동기화가 이 이유로 멈춰 있었다. 컬럼 기본값은 정상이었다.)
    const keepId = (np ? idByPhone.get(np) : undefined) ?? crypto.randomUUID();
    const row: SnapshotRow = {
      id: keepId,
      branch_id: branchId,
      member_name: name,
      phone,
      product_name: null,                                    // 브로제이 회원 목록엔 상품명이 없다(이용권 상세 API에만 존재)
      membership_type: String(m.classification ?? "") || null, // 신규/재등록 등 분류
      start_date: startDate,
      end_date: endDate,
      latest_visit_date: visit,
      payment_amount: paid,
      status,
      source: "broj",
      raw_payload: {
        member_id: m.member_id ?? null,
        agree_advertisement: !!m.agree_advertisement,
        visit_route: m.visit_route ?? null,
        exercise_purpose: m.exercise_purpose ?? null,
        joined_at: msToDate(m.created_at),
        last_ticket_purchased_at: msToDate((m as { last_ticket_purchased_at?: number }).last_ticket_purchased_at),
      },
    };

    // 번호 중복이면 더 "최신"인 쪽만 남긴다 (빈 번호는 유니크 대상이 아니라 그대로 추가)
    if (np) {
      const idx = byPhone.get(np);
      if (idx != null) {
        merged += 1;
        const prev = rows[idx];
        if (prev && rank(row) > rank(prev)) rows[idx] = row;
        continue;
      }
      byPhone.set(np, rows.length);
    }
    rows.push(row);
  }

  // 최종 채택분 기준 집계 (중복 정리 후)
  for (const r of rows) {
    if (r.end_date) withEnd += 1;
    if (r.status === "유효") active += 1; else if (r.status === "만료") expired += 1;
    if (r.payment_amount != null) keptPaid += 1;
  }

  // 4) 반영 — **먼저 쓰고, 나중에 지운다**
  //
  // ⚠️ 예전엔 delete → insert 순서였다. 그러다 insert 가 한 번 실패하면 그 지점 명부가 **0명으로 남는다**.
  //    (2026-08-02 역삼점이 실제로 이렇게 통째로 비었다. 회원관리·케어·환불 자동채움이 다 죽었다.)
  //    순서를 뒤집으면 쓰기가 실패해도 기존 명부가 그대로 살아 있다 — 최악이 '갱신 안 됨'에서 멈춘다.
  if (rows.length > 0) {
    // 4-1) 있으면 갱신, 없으면 추가 (id 기준). 모든 행이 id 를 갖고 있어야 한다(SnapshotRow.id 주석 참고).
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from("member_snapshots")
        // defaultToNull:false = 키가 빠진 행에 NULL 대신 컬럼 DEFAULT 를 쓰게 한다.
        // 이번 사고(키 합집합 → NULL)의 마지막 안전망. id 는 이미 전 행에 채우지만 이중으로 막는다.
        .upsert(rows.slice(i, i + 500), { onConflict: "id", defaultToNull: false });
      if (error) throw new Error(`회원 저장 실패: ${error.message}`);
    }
    // 4-2) 이번 브로제이 응답에 없던 회원만 정리(탈퇴·타지점 이동). 전체 삭제가 아니다.
    //
    // 🚨 삭제 안전장치 — 브로제이가 '일부만' 돌려준 걸 탈퇴로 오해하면 명부가 반토막 난다.
    //    ① 페이지 상한(MAX_PAGES)에 걸려 커서가 남았으면 목록이 불완전하다 → 삭제 금지
    //    ② 기존 대비 절반 이하로 줄었으면 정상 탈퇴가 아니다(실측 변동은 1~3명 수준) → 삭제 금지
    //    막았을 땐 탈퇴자가 하루 더 남을 뿐이고, 안 막으면 수백 명이 사라진다. 어느 쪽이 싼지는 분명하다.
    const keep = new Set(rows.map((r) => r.id));
    const stale = [...existingIds].filter((id) => !keep.has(id));
    const shrankTooMuch = existingIds.size >= 50 && rows.length < existingIds.size * 0.5;
    if (incomplete || shrankTooMuch) {
      console.warn(`[syncMembers] 목록이 불완전해 탈퇴 정리를 건너뜀 branch=${branchId} 기존=${existingIds.size} 수신=${rows.length} 커서잔존=${incomplete}`);
    } else {
      for (let i = 0; i < stale.length; i += 100) {   // URL 길이(8KB) 한도 — uuid 100개면 여유 있다
        const { error } = await db.from("member_snapshots")
          .delete().eq("branch_id", branchId).in("id", stale.slice(i, i + 100));
        // 정리 실패는 치명적이지 않다(탈퇴자가 남을 뿐). 저장은 이미 끝났으니 동기화를 실패로 만들지 않는다.
        if (error) { console.error(`[syncMembers] 탈퇴 정리 실패: ${error.message}`); break; }
      }
    }
  }

  // 4.5) 광고 동의 자동 반영 — 브로제이 agree_advertisement=true 를 fc_member_inputs.ad_consent 로 전파.
  //      이걸 안 하면 동의값이 raw_payload에만 갇혀 카카오(광고) 발송 대상이 0명으로 보인다.
  //      true만 전파한다: 앱에서 수동으로 준 동의를 브로제이 false가 뒤집지 않게(철회는 opt_out·do_not_contact가 담당).
  //      opt_out·do_not_contact 등 다른 필드는 건드리지 않는다.
  const consentSeen = new Set<string>();
  const consentRows: { branch_id: string; normalized_phone: string; member_name: string; ad_consent: boolean }[] = [];
  for (const r of rows) {
    const agreed = (r.raw_payload as { agree_advertisement?: boolean } | null)?.agree_advertisement === true;
    const np = normPhone(r.phone);
    if (!agreed || !np || consentSeen.has(np)) continue;
    consentSeen.add(np);
    consentRows.push({ branch_id: branchId, normalized_phone: np, member_name: r.member_name, ad_consent: true });
  }
  for (let i = 0; i < consentRows.length; i += 500) {
    const { error } = await db.from("fc_member_inputs")
      .upsert(consentRows.slice(i, i + 500), { onConflict: "branch_id,normalized_phone" });
    if (error) throw new Error(`광고 동의 반영 실패: ${error.message}`);
  }

  // 5) 실행 기록
  const { data: job } = await db.from("import_jobs").insert({
    branch_id: branchId, import_type: "broj_members", file_name: `BROJ 회원 ${today}`,
    status: "success", total_rows: members.length, imported_rows: rows.length, failed_rows: 0,
    created_by: createdBy ?? null, completed_at: new Date().toISOString(),
  }).select("id").maybeSingle();

  return {
    ok: true, branch_id: branchId, pages,
    fetched: members.length, written: rows.length,
    active, expired, with_end_date: withEnd, kept_payment: keptPaid, merged,
    job_id: (job as { id: string } | null)?.id ?? null,
  };
}

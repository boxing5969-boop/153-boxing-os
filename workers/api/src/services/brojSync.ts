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
import { brojSalesHistory, brojMembers, brojAttendance, type BrojProductHistory, type BrojMember } from "./brojClient";

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
  opts: { branchId: string; groupId: string; from: string; to: string },
): Promise<SyncAttendanceResult> {
  const { branchId, groupId, from, to } = opts;
  const SIZE = 200;
  const MAX_PAGES = 60;          // 안전 상한 = 12,000건
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>(); // 같은 배치 안 중복 id 방어(upsert 는 배치 내 중복을 못 거른다)
  let pages = 0, fetched = 0;

  // ⚠️ attendance_status 는 필수이고 한 번에 한 값만 받는다(미지정 시 400).
  //    SUCCESS = 출입문 통과, SHOW = 수업 출석. 둘 다 '왔다'이므로 각각 조회해 합쳐야 누락이 없다.
  //    (공개 문서에는 ALL/SUCCESS/FAILURE 로 적혀 있으나 실제 서버는 SUCCESS/SHOW/FAILURE/NO_SHOW 만 받는다)
  for (const status of ["SUCCESS", "SHOW"] as const) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await brojAttendance(env, {
        group_id: groupId, start_date: from, end_date: to, size: SIZE, page_index: page,
        attendance_status: status,
      });
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

  return { ok: true, branch_id: branchId, from, to, pages, fetched, written };
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
  await db.from("sales_entries").delete()
    .eq("branch_id", branchId).eq("source", "broj").gte("sale_date", from).lte("sale_date", to);
  for (let i = 0; i < lines.length; i += 500) {
    const chunk = lines.slice(i, i + 500);
    const { error } = await db.from("sales_entries").insert(chunk);
    if (error) throw new Error(`sales_entries 삽입 실패: ${error.message}`);
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

  // 2) 기존 결제금액 보존용 맵 (전화번호 → payment_amount)
  const paidByPhone = new Map<string, number>();
  {
    const { data } = await db.from("member_snapshots")
      .select("normalized_phone, payment_amount").eq("branch_id", branchId).not("payment_amount", "is", null);
    for (const r of (data as { normalized_phone: string | null; payment_amount: number | null }[] | null) ?? []) {
      if (r.normalized_phone && r.payment_amount != null) paidByPhone.set(r.normalized_phone, r.payment_amount);
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

    const row: SnapshotRow = {
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

  // 4) 전체 교체 — 브로제이가 원본
  if (rows.length > 0) {
    const { error: delErr } = await db.from("member_snapshots").delete().eq("branch_id", branchId);
    if (delErr) throw new Error(`기존 회원 삭제 실패: ${delErr.message}`);
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from("member_snapshots").insert(rows.slice(i, i + 500));
      if (error) throw new Error(`회원 저장 실패: ${error.message}`);
    }
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

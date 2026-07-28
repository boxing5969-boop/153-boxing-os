/**
 * 브로제이(BROJ) 자동 동기화 (B5).
 *
 * 매일 00:05 KST 크론에서 일일 리포트 발송 '직전'에 돌아, 대표님이 받는 리포트 숫자가
 * 브로제이 실시간 값과 같아지게 한다.
 *
 * 대상 = branches 중 broj_group_id 가 연결되고 broj_auto_sync=true 인 지점 전부.
 * 지점마다 ① 회원 명부 ② 이번 결산월 매출 순으로 돌리고, 성공·실패를 broj_sync_runs 에 남긴다.
 *
 * 원칙:
 * - 한 지점이 실패해도 다음 지점은 계속 돈다(부분 실패 허용).
 * - 이 함수는 절대 throw 하지 않는다 — 크론 체인의 일일 리포트·자동발송을 막으면 안 된다.
 * - 실패는 삼키지 말고 broj_sync_runs 에 error_message 로 남겨 화면에서 보이게 한다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../lib/env";
import { getServiceClient } from "../lib/supabase";
import { hasBrojKey } from "./brojClient";
import { syncMembers, syncSales, fillPaymentAmounts, syncAttendance, refreshAttendanceStats } from "./brojSync";

/** KST(UTC+9) 기준 오늘 YYYY-MM-DD */
export function kstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
/** KST 기준 이번 달 1일 */
export function kstMonthStart(): string {
  return kstToday().slice(0, 8) + "01";
}

/**
 * 지점 결산월 범위. startDay=1 → 달력월, 13 → 13일~다음달 12일.
 * offset 0=이번 결산월(오늘까지), -1=지난 결산월(전체).
 */
export function fiscalRange(today: string, startDay: number, offset: 0 | -1): { from: string; to: string } {
  const y = Number(today.slice(0, 4)); const m = Number(today.slice(5, 7)); const d = Number(today.slice(8, 10));
  const sd = startDay > 1 ? startDay : 1;
  let sy = y, sm = m;
  if (sd > 1 && d < sd) { sm = m === 1 ? 12 : m - 1; sy = m === 1 ? y - 1 : y; }
  if (offset === -1) { sm = sm === 1 ? 12 : sm - 1; sy = sm === 12 ? sy - 1 : sy; }
  const start = new Date(Date.UTC(sy, sm - 1, sd));
  const nextStart = new Date(Date.UTC(sy, sm, sd));
  const end = new Date(nextStart); end.setUTCDate(end.getUTCDate() - 1);
  const from = start.toISOString().slice(0, 10);
  const endS = end.toISOString().slice(0, 10);
  return { from, to: offset === 0 && endS > today ? today : endS };
}

export interface SyncRunLog {
  branchId: string;
  kind: "members" | "sales" | "attendance";
  mode: "auto" | "manual";
  status: "success" | "failed";
  from?: string | null;
  to?: string | null;
  fetched?: number;
  written?: number;
  salesTotal?: number;
  error?: string | null;
  startedAt: string;
}

/**
 * 동기화 1건 결과를 이력에 기록. 기록 자체가 실패해도 동기화를 되돌리지 않는다(로그만).
 * 수동 버튼(mode='manual')도 같은 테이블에 쌓아 "마지막 동기화" 한 곳에서 본다.
 */
export async function logSyncRun(db: SupabaseClient, log: SyncRunLog): Promise<void> {
  const { error } = await db.from("broj_sync_runs").insert({
    branch_id: log.branchId,
    kind: log.kind,
    mode: log.mode,
    status: log.status,
    from_date: log.from ?? null,
    to_date: log.to ?? null,
    fetched: log.fetched ?? 0,
    written: log.written ?? 0,
    sales_total: Math.round(log.salesTotal ?? 0),
    error_message: log.error ? String(log.error).slice(0, 500) : null,
    started_at: log.startedAt,
    finished_at: new Date().toISOString(),
  });
  if (error) console.error("[brojAutoSync] 이력 기록 실패", error.message);
}

interface BranchRow {
  id: string;
  name: string;
  broj_group_id: string;
  fiscal_start_day?: number | null;
  broj_auto_sync?: boolean | null;
}

export interface AutoSyncBranchResult {
  branch_id: string;
  name: string;
  members_ok: boolean;
  members_written: number;
  sales_ok: boolean;
  sales_total: number;
  attendance_ok: boolean;
  attendance_written: number;
  from: string;
  to: string;
  errors: string[];
}

export interface AutoSyncReport {
  ran: boolean;
  reason?: string;
  branches: AutoSyncBranchResult[];
}

/** 연결된 전 지점 자동 동기화. 절대 throw 하지 않는다. */
export async function runBrojAutoSync(env: Env): Promise<AutoSyncReport> {
  if (!hasBrojKey(env)) return { ran: false, reason: "NO_KEY", branches: [] };

  const db = getServiceClient(env);
  const { data, error } = await db
    .from("branches")
    .select("id, name, broj_group_id, fiscal_start_day, broj_auto_sync")
    .not("broj_group_id", "is", null);
  if (error) {
    console.error("[brojAutoSync] 지점 조회 실패", error.message);
    return { ran: false, reason: "BRANCH_QUERY_FAIL", branches: [] };
  }

  const targets = ((data as BranchRow[] | null) ?? []).filter((b) => b.broj_auto_sync !== false);
  if (targets.length === 0) return { ran: false, reason: "NO_TARGET", branches: [] };

  const today = kstToday();
  const results: AutoSyncBranchResult[] = [];

  for (const b of targets) {
    const startDay = Number(b.fiscal_start_day ?? 1) || 1;
    const range = fiscalRange(today, startDay, 0);
    const r: AutoSyncBranchResult = {
      branch_id: b.id, name: b.name,
      members_ok: false, members_written: 0,
      sales_ok: false, sales_total: 0,
      attendance_ok: false, attendance_written: 0,
      from: range.from, to: range.to, errors: [],
    };

    // ① 회원 명부 (만료일·최근방문 포함)
    const t1 = new Date().toISOString();
    try {
      const m = await syncMembers(db, env, { branchId: b.id, groupId: b.broj_group_id, createdBy: null });
      r.members_ok = true; r.members_written = m.written;
      await logSyncRun(db, {
        branchId: b.id, kind: "members", mode: "auto", status: "success",
        fetched: m.fetched, written: m.written, startedAt: t1,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "회원 동기화 실패";
      r.errors.push(`회원: ${msg}`);
      await logSyncRun(db, { branchId: b.id, kind: "members", mode: "auto", status: "failed", error: msg, startedAt: t1 });
    }

    // ② 이번 결산월 매출
    const t2 = new Date().toISOString();
    try {
      const s = await syncSales(db, env, {
        branchId: b.id, groupId: b.broj_group_id, from: range.from, to: range.to, createdBy: null,
      });
      r.sales_ok = true; r.sales_total = s.sales_total;
      await logSyncRun(db, {
        branchId: b.id, kind: "sales", mode: "auto", status: "success",
        from: range.from, to: range.to, written: s.lines_written, salesTotal: s.sales_total, startedAt: t2,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "매출 동기화 실패";
      r.errors.push(`매출: ${msg}`);
      await logSyncRun(db, {
        branchId: b.id, kind: "sales", mode: "auto", status: "failed",
        from: range.from, to: range.to, error: msg, startedAt: t2,
      });
    }

    // ③ 출석(출입) 이력 — 최근 14일만 재동기화(멱등). 과거분은 수동 백필로 한 번만 채운다.
    const t3 = new Date().toISOString();
    const attFrom = new Date(Date.parse(`${today}T00:00:00Z`) - 13 * 86400000).toISOString().slice(0, 10);
    try {
      const a = await syncAttendance(db, env, { branchId: b.id, groupId: b.broj_group_id, from: attFrom, to: today });
      r.attendance_ok = true; r.attendance_written = a.written;
      await logSyncRun(db, {
        branchId: b.id, kind: "attendance", mode: "auto", status: "success",
        from: attFrom, to: today, fetched: a.fetched, written: a.written, startedAt: t3,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "출석 동기화 실패";
      r.errors.push(`출석: ${msg}`);
      await logSyncRun(db, {
        branchId: b.id, kind: "attendance", mode: "auto", status: "failed",
        from: attFrom, to: today, error: msg, startedAt: t3,
      });
    }

    results.push(r);
  }

  // 출석 이력 → 회원별 방문 빈도(7/30/90일)·마지막 방문일 갱신
  try {
    const s = await refreshAttendanceStats(db, null);
    console.log("[brojAutoSync] 방문빈도 갱신", s.updated);
  } catch (e) {
    console.error("[brojAutoSync] refreshAttendanceStats", e);
  }

  // 회원 명부가 갈아끼워졌으니 결제금액(환불계산기 자동채움)을 매출에서 다시 채운다.
  try {
    const p = await fillPaymentAmounts(db, null);
    console.log("[brojAutoSync] 결제금액 채움", p.filled);
  } catch (e) {
    console.error("[brojAutoSync] fillPaymentAmounts", e);
  }

  return { ran: true, branches: results };
}

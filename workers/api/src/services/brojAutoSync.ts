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
import { syncMembers, syncSales, fillPaymentAmounts, syncAttendance, refreshAttendanceStats, refreshTicketStats, syncMemberHolds } from "./brojSync";

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
  /** attendance_backfill = 60일 깊은 백필(구멍 메우기). DB CHECK 제약도 같이 넓혀야 한다 */
  kind: "members" | "sales" | "attendance" | "attendance_backfill";
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

  const all = ((data as BranchRow[] | null) ?? []).filter((b) => b.broj_auto_sync !== false);
  if (all.length === 0) return { ran: false, reason: "NO_TARGET", branches: [] };

  // ⚠️ 순서를 매일 돌린다.
  //    항상 같은 지점이 첫 번째면, 그 지점에서 시간을 다 쓸 때 뒤 지점들은 영영 자동 동기화가 안 된다.
  //    (실제로 선릉이 늘 먼저라 역삼·잠실은 자동 실행 기록이 아예 없었다)
  const dayIdx = Math.floor(Date.now() / 86400000);
  const off = all.length ? dayIdx % all.length : 0;
  const targets = [...all.slice(off), ...all.slice(0, off)];

  const today = kstToday();
  const results: AutoSyncBranchResult[] = [];

  // ⚠️ 크론 한 번에 전 지점·전 종류를 다 돌리면 워커 실행 시간을 넘겨 통째로 죽는다("Network connection lost.").
  //    남은 시간을 보고, 예산을 넘기면 남은 단계를 '건너뜀'으로 남기고 다음 날로 미룬다.
  //    실패가 아니라 미룬 것이므로 다음 실행에서 자연히 채워진다.
  const BUDGET_MS = 45_000;
  const startedMs = Date.now();
  const outOfTime = (): boolean => Date.now() - startedMs > BUDGET_MS;

  for (const b of targets) {
    if (outOfTime()) {
      results.push({
        branch_id: b.id, name: b.name,
        members_ok: false, members_written: 0, sales_ok: false, sales_total: 0,
        attendance_ok: false, attendance_written: 0,
        from: today, to: today, errors: ["시간이 부족해 다음 실행으로 미뤘습니다"],
      });
      continue;
    }
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
    const attFrom = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);   // 최근 7일(부하 축소)
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

    // ④ 홀딩(일시정지) — 회원당 1콜이라 가장 무겁다. 시간이 남을 때만, 매일 조금씩.
    try {
      if (outOfTime()) throw new Error("시간 부족 — 홀딩은 다음 실행으로");
      const h = await syncMemberHolds(db, env, { branchId: b.id, groupId: b.broj_group_id, batch: 20 });
      console.log("[brojAutoSync] 홀딩", b.name, h);
    } catch (e) {
      console.error("[brojAutoSync] syncMemberHolds", b.name, e);
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
  // 출석 기록의 이용권 정보 → 잔여 횟수 + 비어 있던 만료일 보완
  try {
    const t = await refreshTicketStats(db, null);
    console.log("[brojAutoSync] 이용권 보강", t);
  } catch (e) {
    console.error("[brojAutoSync] refreshTicketStats", e);
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

/**
 * 출석만 따로 — **전 지점, 매시간**.
 *
 * ⚠️ 왜 분리했나 (2026-08-01, 대표님이 "저녁 8명은 말이 안 된다"고 짚어 발견)
 *    기존 runBrojAutoSync 는 45초 예산 안에서 회원 명부(수백 명 전체 교체)·매출·출석·홀딩을 지점마다 순서대로 돌린다.
 *    한 지점을 채우면 예산이 끝나 다음 지점은 다음 날로 밀렸다 → 지점이 3곳이면 **각 지점 출석이 3일에 한 번**만 갱신.
 *    그래서 선릉·역삼은 7/31 저녁 출입이 통째로 비어 있었다(잠실만 그날 차례라 정상).
 *    출석은 최근 3일치라 지점당 1초 안쪽으로 가볍다. 무거운 명부·매출과 분리해 매시간 전 지점을 돌린다.
 *    (명부·매출은 하루 단위로 변해도 되니 기존 로테이션 유지)
 */
/**
 * light 모드 (2026-08-13) — 라이브보드가 "지금 운동 중"을 실시간으로 띄우기 위해 5분마다 도는 경량 버전.
 *
 * 왜 필요했나: 출석이 매시간(:20) 한 번만 들어와서, 21시에 온 회원이 21:30 동기화 전까지
 *   보드에 아예 없었다. 대표님이 CCTV엔 8명인데 보드엔 3명이라고 짚어 발견.
 *   실측 지연: 입실 19:30 → DB 20:30 (60분), 20:58 → 21:30 (32분).
 *
 * 무거운 부분을 덜어낸다:
 *   · 조회 범위 3일 → 오늘 하루 (호출·행수 감소)
 *   · refreshAttendanceStats(7·30·90일 재계산) 생략 — 케어 판정용이라 5분 신선도가 필요 없다
 *   · 성공 로그(broj_sync_runs) 생략 — 5분마다 쌓으면 로그가 하루 288줄이 된다. 실패만 남긴다
 * 정시(:20) 동기화는 그대로 두어 3일치 보정·통계 갱신을 계속 담당한다.
 */
export async function runBrojAttendanceSync(
  env: Env,
  opts?: { light?: boolean },
): Promise<{ ran: boolean; branches: { name: string; ok: boolean; written: number }[] }> {
  const light = opts?.light === true;
  const db = getServiceClient(env);
  if (!hasBrojKey(env)) return { ran: false, branches: [] };
  const { data } = await db.from("branches")
    .select("id, name, broj_group_id, broj_auto_sync, fiscal_start_day")
    .not("broj_group_id", "is", null);
  const all = ((data as BranchRow[] | null) ?? []).filter((b) => b.broj_auto_sync !== false);
  if (all.length === 0) return { ran: false, branches: [] };

  const today = kstToday();
  // light = 오늘만, 정시 = 최근 3일(늦게 반영되는 건까지 보정)
  const from = light
    ? today
    : new Date(Date.parse(`${today}T00:00:00Z`) - 2 * 86400000).toISOString().slice(0, 10);
  const startedMs = Date.now();
  const budgetMs = light ? 20_000 : 40_000;
  const out: { name: string; ok: boolean; written: number }[] = [];

  for (const b of all) {
    if (Date.now() - startedMs > budgetMs) {    // 안전 예산 — 남은 지점은 다음 회차에
      out.push({ name: b.name, ok: false, written: 0 });
      continue;
    }
    const t = new Date().toISOString();
    try {
      const a = await syncAttendance(db, env, {
        branchId: b.id, groupId: b.broj_group_id, from, to: today,
        // light 는 하루치라 지점당 2~3콜이면 끝난다. 상한을 낮게 못 박아 한 지점이 예산을 다 먹지 않게.
        ...(light ? { maxCalls: 6 } : {}),
      });
      out.push({ name: b.name, ok: true, written: a.written });
      // 매시간이라 로그가 쌓인다 — 실제로 뭔가 들어온 경우만 기록 (light 는 5분마다라 성공 로그 생략)
      if (!light && a.written > 0) {
        await logSyncRun(db, {
          branchId: b.id, kind: "attendance", mode: "auto", status: "success",
          from, to: today, fetched: a.fetched, written: a.written, startedAt: t,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "출석 동기화 실패";
      out.push({ name: b.name, ok: false, written: 0 });
      await logSyncRun(db, {
        branchId: b.id, kind: "attendance", mode: "auto", status: "failed",
        from, to: today, error: msg, startedAt: t,
      });
    }
  }
  // 출석이 갱신됐으니 회원별 방문 통계(7·30·90일)도 다시 계산 — 케어 대상 판정의 근거.
  // light 는 건너뛴다: 무겁고, 케어 판정은 정시 동기화(:20)가 갱신해주면 충분하다.
  if (!light) {
    try { await refreshAttendanceStats(db, null); } catch (e) { console.error("[brojAttendanceSync] stats", e); }
  }
  return { ran: true, branches: out };
}

/**
 * 홀딩(일시정지) **매시간 스윕** — 유효회원을 조금씩, 그러나 자주 갱신한다.
 *
 * ⚠️ 왜 매시간인가 (2026-08-02, 대표님이 "브로제이엔 홀딩 5명인데 앱엔 0명" 이라고 짚어 발견)
 *    홀딩은 브로제이 **회원 목록에 안 나온다**. 회원 1명당 이용권 API 1콜을 해야만 알 수 있다.
 *    기존엔 하루 한 지점 20명씩 → 유효회원 440명을 한 바퀴 도는 데 3주가 걸렸다.
 *    그동안 홀딩 회원은 앱에서 그냥 '유효'로 보이고, 자동발송 제외도 안 걸린다.
 *    → 매시간 1회, 지점 1곳, 18명씩 돌린다(= 하루 432명). 하루면 전원 한 바퀴가 돈다.
 *    18명인 이유: 워커 1회 실행의 서브리퀘스트 한도(무료 50) 안에서 회원당 2콜(조회+갱신)을 쓴다.
 *    지점은 '아직 안 본 회원이 가장 많은 곳'부터 — 밀린 곳이 먼저 줄어든다.
 */
export async function runHoldsSweep(env: Env): Promise<{ ran: boolean; branch?: string; checked?: number; holding?: number; remaining?: number }> {
  const db = getServiceClient(env);
  if (!hasBrojKey(env)) return { ran: false };
  const { data } = await db.from("branches")
    .select("id, name, broj_group_id, broj_auto_sync, fiscal_start_day")
    .not("broj_group_id", "is", null);
  const all = ((data as BranchRow[] | null) ?? []).filter((b) => b.broj_auto_sync !== false);
  if (all.length === 0) return { ran: false };

  // 지점별 '아직 안 본 유효회원' 수 — 가장 많이 밀린 지점을 고른다
  const today = kstToday();
  const staleSince = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  let target: BranchRow | null = null;
  let worst = 0;
  for (const b of all) {
    const { count } = await db.from("member_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("branch_id", b.id)
      // syncMemberHolds 의 대상 정의와 반드시 동일해야 한다 — 다르면 '밀린 지점' 판단이 어긋난다
      .or(`end_date.gte.${today},end_date.is.null,hold_status.eq.HOLDING`)
      .or(`ticket_checked_at.is.null,ticket_checked_at.lt.${staleSince}`);
    const n = count ?? 0;
    if (n > worst) { worst = n; target = b; }
  }
  if (!target || worst === 0) return { ran: true };   // 전원 최신 — 쉬어간다

  try {
    const r = await syncMemberHolds(db, env, { branchId: target.id, groupId: target.broj_group_id, batch: 18 });
    return { ran: true, branch: target.name, checked: r.checked, holding: r.holding, remaining: r.remaining };
  } catch (e) {
    console.error("[holdsSweep]", target.name, e);
    return { ran: true, branch: target.name, checked: 0 };
  }
}

/**
 * 출석 **깊은 백필** — 매일 새벽, 지점 1곳씩 돌아가며 최근 60일을 통째로 다시 가져온다.
 *
 * 왜 필요한가: 매시간 동기화는 최근 3일만 본다. 그 3일 창을 놓친 구간(워커 장애·브로제이 점검·
 * 늦게 등록된 출입)은 영원히 빈 채로 남는다. "지난 토요일 누가 왔나"를 우리 DB로 답하려면
 * 과거가 메워져 있어야 하므로, 하루 한 지점씩 60일 창을 다시 훑어 구멍을 메운다.
 * upsert(branch_id, broj_attendance_id)라 여러 번 돌려도 중복이 생기지 않는다.
 *
 * 지점 순번은 broj_sync_runs 의 마지막 성공 시각으로 정한다(가장 오래 안 한 지점 먼저).
 * 별도 상태 테이블을 만들지 않는 이유 — 상태가 두 곳에 있으면 반드시 어긋난다.
 */
export async function runBrojAttendanceBackfill(
  env: Env,
  opts: { days?: number } = {},
): Promise<{ ran: boolean; branch?: string; from?: string; to?: string; written?: number; error?: string }> {
  const db = getServiceClient(env);
  if (!hasBrojKey(env)) return { ran: false };
  const { data } = await db.from("branches")
    .select("id, name, broj_group_id, broj_auto_sync, fiscal_start_day")
    .not("broj_group_id", "is", null);
  const all = ((data as BranchRow[] | null) ?? []).filter((b) => b.broj_auto_sync !== false);
  if (all.length === 0) return { ran: false };

  // 지점별 마지막 **시도** 시각 → 없는(=한 번도 안 한) 지점이 최우선.
  // ⚠️ 성공만 세면 안 된다: 한 지점이 계속 실패하면 그 지점의 마지막 시각이 영원히 비어
  //    매일 1등으로 뽑히고, 나머지 지점은 영영 백필되지 않는다(기아). 성공/실패 모두 순번에 반영한다.
  // mode='auto' 만 본다 — 사람이 누른 수동 백필(짧은 구간일 수도 있다)이 자동 순번을 밀어내면 안 된다.
  const { data: runs } = await db.from("broj_sync_runs")
    .select("branch_id, started_at")
    .eq("kind", "attendance_backfill").eq("mode", "auto")
    .order("started_at", { ascending: false })
    .limit(200);
  const lastAt = new Map<string, string>();
  for (const r of ((runs as { branch_id: string; started_at: string }[] | null) ?? [])) {
    if (!lastAt.has(r.branch_id)) lastAt.set(r.branch_id, r.started_at);
  }
  const target = [...all].sort((a, b) => {
    const x = lastAt.get(a.id) ?? "", y = lastAt.get(b.id) ?? "";
    return x < y ? -1 : x > y ? 1 : 0;   // 동률 0 — 정렬 규약을 지킨다
  })[0];
  if (!target) return { ran: false };

  const days = Math.min(Math.max(opts.days ?? 60, 7), 80);   // 브로제이 90일 한도 안쪽
  const to = kstToday();
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * 86400000).toISOString().slice(0, 10);
  const startedAt = new Date().toISOString();
  try {
    const a = await syncAttendance(db, env, { branchId: target.id, groupId: target.broj_group_id, from, to });
    await logSyncRun(db, {
      branchId: target.id, kind: "attendance_backfill", mode: "auto", status: "success",
      from, to, fetched: a.fetched, written: a.written, startedAt,
    });
    // 과거가 메워졌으면 방문 통계도 다시 — 안 하면 케어 판정이 옛 숫자로 남는다
    try { await refreshAttendanceStats(db, null); } catch (e) { console.error("[brojBackfill] stats", e); }
    return { ran: true, branch: target.name, from, to, written: a.written };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "출석 백필 실패";
    await logSyncRun(db, {
      branchId: target.id, kind: "attendance_backfill", mode: "auto", status: "failed",
      from, to, error: msg, startedAt,
    });
    return { ran: true, branch: target.name, from, to, error: msg };
  }
}

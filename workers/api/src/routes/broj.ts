/**
 * 브로제이(BROJ) 오픈 API 연동 (/api/broj)
 *
 * - B1 범위: GET /status — 키 연결 상태·권한·지점·호출한도 확인(읽기전용). 본사(HQ) 전용.
 * - 회원/매출/출석 동기화는 다음 Phase(B2~)에서 추가한다.
 * - 응답 형식 { success, data }. BROJ 호출 실패도 200 으로 감싸(connected:false+사유) 화면에서 안내.
 */
import { Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../lib/env";
import { fail, ok } from "../lib/responses";
import { requireJwt } from "../middleware/jwt";
import { getServiceClient } from "../lib/supabase";
import { brojStatus, brojGroups, brojMembers, hasBrojKey, BrojError } from "../services/brojClient";
import { syncSales, syncMembers, fillPaymentAmounts, syncAttendance, refreshAttendanceStats, refreshTicketStats, syncMemberHolds } from "../services/brojSync";
// 날짜/결산월 계산과 이력 기록은 자동 동기화(크론)와 같은 구현을 공유한다 — 수동·자동 결과가 어긋나면 안 된다.
import { kstToday, kstMonthStart, fiscalRange, logSyncRun } from "../services/brojAutoSync";

export const brojRoutes = new Hono<{ Bindings: Env }>();

const HQ_ROLES = new Set(["super_admin", "hq_admin"]);

interface ProfileRow {
  id: string;
  role: string;
  branch_id: string | null;
}

async function getProfile(db: SupabaseClient, authUserId: string): Promise<ProfileRow | null> {
  const { data } = await db
    .from("profiles")
    .select("id, role, branch_id, status")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  const p = data as (ProfileRow & { status?: string }) | null;
  return p && p.status === "active" ? p : null; // 승인(active) 계정만
}

/** GET /api/broj/status — 본사 전용. 브로제이 API 키 연결 상태 확인. */
brojRoutes.get("/status", requireJwt, async (c) => {
  const user = c.get("user");
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, user.id);
  if (!profile) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!HQ_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "본사 관리자만 확인할 수 있습니다", 403);

  if (!hasBrojKey(c.env)) {
    // 키 미등록 — 아직 시크릿을 넣지 않은 상태(정상 흐름)
    return ok(c, { configured: false, connected: false });
  }
  try {
    const s = await brojStatus(c.env);
    return ok(c, { configured: true, connected: s.connected ?? true, ...s });
  } catch (e) {
    const status = e instanceof BrojError ? e.status : 0;
    const message = e instanceof Error ? e.message : "BROJ 상태 조회 실패";
    // 키는 있으나 연결 실패 — 엔드포인트 자체는 성공, 상태만 실패로 내려 화면에서 사유 안내
    return ok(c, { configured: true, connected: false, error: { status, message } });
  }
});

/** GET /api/broj/groups — 본사 전용. 접근 가능한 센터(지점) 목록 + 회원 미리보기(최대 3명, DB 기록 없음). */
brojRoutes.get("/groups", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!HQ_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "본사 관리자만 확인할 수 있습니다", 403);
  if (!hasBrojKey(c.env)) return ok(c, { configured: false, groups: [] });

  try {
    const groups = await brojGroups(c.env);
    const list = (groups ?? []).map((g) => ({
      group_id: g.group_id ?? "",
      group_name: g.group_name ?? "",
      region: g.region ?? "",
      phone_number: g.phone_number ?? "",
    }));
    // 첫 지점 회원 3명만 미리보기(필드 확인용) — 저장 안 함, 이름은 마스킹
    let sample: { name: string; phone_tail: string; has_marketing: boolean; classification: string }[] = [];
    let total_hint: number | null = null;
    const gid = list[0]?.group_id;
    if (gid) {
      try {
        const page = await brojMembers(c.env, { group_id: gid, limit: 3 });
        sample = (page.data ?? []).slice(0, 3).map((m) => ({
          name: (m.name ?? "").slice(0, 1) + "**",
          phone_tail: (m.phone_number ?? "").replace(/\D/g, "").slice(-4),
          has_marketing: !!m.agree_advertisement,
          classification: m.classification ?? "",
        }));
        total_hint = page.pagination?.has_next ? -1 : sample.length; // -1 = 더 있음
      } catch { /* 미리보기 실패는 무시 */ }
    }
    return ok(c, { configured: true, groups: list, sample, total_hint });
  } catch (e) {
    const status = e instanceof BrojError ? e.status : 0;
    const message = e instanceof Error ? e.message : "센터 목록 조회 실패";
    return ok(c, { configured: true, groups: [], error: { status, message } });
  }
});

/**
 * POST /api/broj/sync/sales — 본사 전용. 브로제이 상품 매출 → sales_entries + daily_reports 동기화.
 * body: { branch_id?, from?(YYYY-MM-DD), to? }. branch_id 미지정 시 broj_group_id 매핑된 지점이 1곳이면 자동.
 * 재실행해도 결과 동일(멱등). 읽기(BROJ) + 우리 DB 쓰기만 — 브로제이엔 쓰지 않음.
 */
brojRoutes.post("/sync/sales", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!HQ_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "본사 관리자만 실행할 수 있습니다", 403);
  if (!hasBrojKey(c.env)) return fail(c, "NO_KEY", "브로제이 API 키가 등록되지 않았습니다", 400);

  const body = await c.req.json<{ branch_id?: string; from?: string; to?: string }>().catch(() => ({} as Record<string, string>));
  const from = (body.from ?? kstMonthStart()).slice(0, 10);
  const to = (body.to ?? kstToday()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return fail(c, "BAD_DATE", "조회 기간 형식이 올바르지 않습니다", 400);
  if (from > to) return fail(c, "BAD_RANGE", "시작일이 종료일보다 늦습니다", 400);

  // 대상 지점 + 브로제이 센터(group_id) 매핑 확인
  let branchId = body.branch_id ?? "";
  let groupId = "";
  if (branchId) {
    const { data } = await db.from("branches").select("id, broj_group_id").eq("id", branchId).maybeSingle();
    const b = data as { id: string; broj_group_id: string | null } | null;
    if (!b) return fail(c, "NO_BRANCH", "지점을 찾을 수 없습니다", 404);
    if (!b.broj_group_id) return fail(c, "NO_MAPPING", "이 지점에 연결된 브로제이 센터가 없습니다", 400);
    groupId = b.broj_group_id;
  } else {
    const { data } = await db.from("branches").select("id, broj_group_id").not("broj_group_id", "is", null);
    const mapped = (data as { id: string; broj_group_id: string }[] | null) ?? [];
    if (mapped.length === 0) return fail(c, "NO_MAPPING", "브로제이 센터가 연결된 지점이 없습니다", 400);
    if (mapped.length > 1) return fail(c, "MULTI", "연결된 지점이 여러 곳입니다. 지점을 지정하세요", 400);
    const only = mapped[0];
    if (!only) return fail(c, "NO_MAPPING", "브로제이 센터가 연결된 지점이 없습니다", 400);
    branchId = only.id;
    groupId = only.broj_group_id;
  }

  const startedAt = new Date().toISOString();
  try {
    const result = await syncSales(db, c.env, { branchId, groupId, from, to, createdBy: profile.id });
    await logSyncRun(db, {
      branchId, kind: "sales", mode: "manual", status: "success",
      from, to, written: result.lines_written, salesTotal: result.sales_total, startedAt,
    });
    return ok(c, result);
  } catch (e) {
    const status = e instanceof BrojError ? e.status : 0;
    const message = e instanceof Error ? e.message : "매출 동기화 실패";
    await logSyncRun(db, { branchId, kind: "sales", mode: "manual", status: "failed", from, to, error: message, startedAt });
    return fail(c, "SYNC_FAIL", message, status === 429 ? 429 : 500);
  }
});

/**
 * POST /api/broj/sync/all — 본사 전용. broj_group_id 매핑된 전 지점을 각자 센터에서 동기화.
 * body: { from?, to? }. 한 번에 선릉·잠실·역삼 등 전부 갱신(멱등).
 */
brojRoutes.post("/sync/all", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!HQ_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "본사 관리자만 실행할 수 있습니다", 403);
  if (!hasBrojKey(c.env)) return fail(c, "NO_KEY", "브로제이 API 키가 등록되지 않았습니다", 400);

  const body = await c.req.json<{ from?: string; to?: string; month?: string }>().catch(() => ({} as { from?: string; to?: string; month?: string }));
  const from = (body.from ?? kstMonthStart()).slice(0, 10);
  const to = (body.to ?? kstToday()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return fail(c, "BAD_DATE", "조회 기간 형식이 올바르지 않습니다", 400);
  if (from > to) return fail(c, "BAD_RANGE", "시작일이 종료일보다 늦습니다", 400);

  const { data } = await db.from("branches").select("id, name, broj_group_id, fiscal_start_day").not("broj_group_id", "is", null);
  const mapped = (data as { id: string; name: string; broj_group_id: string; fiscal_start_day?: number }[] | null) ?? [];
  if (mapped.length === 0) return fail(c, "NO_MAPPING", "브로제이 센터가 연결된 지점이 없습니다", 400);

  // month=this|last 이면 지점별 결산월(fiscal_start_day)로 기간을 각자 계산
  const monthMode = body.month === "this" || body.month === "last" ? body.month : null;

  const branches: { branch_id: string; name: string; ok: boolean; from: string; to: string; sales_total: number; refund_total: number; days: number; error?: string }[] = [];
  for (const b of mapped) {
    const startDay = Number(b.fiscal_start_day ?? 1) || 1;
    const range = monthMode ? fiscalRange(kstToday(), startDay, monthMode === "last" ? -1 : 0) : { from, to };
    const startedAt = new Date().toISOString();
    try {
      const r = await syncSales(db, c.env, { branchId: b.id, groupId: b.broj_group_id, from: range.from, to: range.to, createdBy: profile.id });
      branches.push({ branch_id: b.id, name: b.name, ok: true, from: range.from, to: range.to, sales_total: r.sales_total, refund_total: r.refund_total, days: r.days });
      await logSyncRun(db, {
        branchId: b.id, kind: "sales", mode: "manual", status: "success",
        from: range.from, to: range.to, written: r.lines_written, salesTotal: r.sales_total, startedAt,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "실패";
      branches.push({ branch_id: b.id, name: b.name, ok: false, from: range.from, to: range.to, sales_total: 0, refund_total: 0, days: 0, error: message });
      await logSyncRun(db, { branchId: b.id, kind: "sales", mode: "manual", status: "failed", from: range.from, to: range.to, error: message, startedAt });
    }
  }
  return ok(c, { from, to, branches });
});

/**
 * POST /api/broj/sync/members — 본사 전용. 연결된 전 지점의 회원 명부를 브로제이 기준으로 갱신.
 * 회원 목록에 회원권 기간·최근출석이 함께 오므로 회원당 개별 조회가 필요 없다.
 * 기존 결제금액(엑셀 입력분)은 전화번호로 매칭해 보존한다.
 */
brojRoutes.post("/sync/members", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!HQ_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "본사 관리자만 실행할 수 있습니다", 403);
  if (!hasBrojKey(c.env)) return fail(c, "NO_KEY", "브로제이 API 키가 등록되지 않았습니다", 400);

  const body = await c.req.json<{ branch_id?: string }>().catch(() => ({} as { branch_id?: string }));
  let q = db.from("branches").select("id, name, broj_group_id").not("broj_group_id", "is", null);
  if (body.branch_id) q = q.eq("id", body.branch_id);
  const { data } = await q;
  const mapped = (data as { id: string; name: string; broj_group_id: string }[] | null) ?? [];
  if (mapped.length === 0) return fail(c, "NO_MAPPING", "브로제이 센터가 연결된 지점이 없습니다", 400);

  const branches: {
    branch_id: string; name: string; ok: boolean;
    fetched: number; written: number; active: number; expired: number; with_end_date: number; error?: string;
  }[] = [];
  for (const b of mapped) {
    const startedAt = new Date().toISOString();
    try {
      const r = await syncMembers(db, c.env, { branchId: b.id, groupId: b.broj_group_id, createdBy: profile.id });
      branches.push({
        branch_id: b.id, name: b.name, ok: true,
        fetched: r.fetched, written: r.written, active: r.active, expired: r.expired, with_end_date: r.with_end_date,
      });
      await logSyncRun(db, {
        branchId: b.id, kind: "members", mode: "manual", status: "success",
        fetched: r.fetched, written: r.written, startedAt,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "실패";
      branches.push({
        branch_id: b.id, name: b.name, ok: false,
        fetched: 0, written: 0, active: 0, expired: 0, with_end_date: 0,
        error: message,
      });
      await logSyncRun(db, { branchId: b.id, kind: "members", mode: "manual", status: "failed", error: message, startedAt });
    }
  }

  // 명부를 갈아끼웠으니 결제금액(환불계산기 자동채움용)을 매출에서 다시 채운다.
  let payments = 0;
  try {
    const r = await fillPaymentAmounts(db, body.branch_id ?? null);
    payments = r.filled;
  } catch (e) {
    console.error("[broj] fillPaymentAmounts", e);
  }

  return ok(c, { branches, payments_filled: payments });
});

/**
 * POST /api/broj/sync/attendance — 본사 전용. 출석(출입) 이력 동기화.
 * body: { days?(기본 30), from?, to? }. 재실행해도 중복되지 않는다.
 * 끝나면 회원별 방문 빈도(7/30/90일)와 마지막 방문일을 갱신한다.
 */
brojRoutes.post("/sync/attendance", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!HQ_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "본사 관리자만 실행할 수 있습니다", 403);
  if (!hasBrojKey(c.env)) return fail(c, "NO_KEY", "브로제이 API 키가 등록되지 않았습니다", 400);

  const body = await c.req.json<{ days?: number; from?: string; to?: string; branch_id?: string }>()
    .catch(() => ({} as { days?: number; from?: string; to?: string; branch_id?: string }));
  const to = (body.to ?? kstToday()).slice(0, 10);
  const days = Math.min(Math.max(Number(body.days ?? 30) || 30, 1), 400);
  const from = (body.from ?? new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * 86400000)
    .toISOString().slice(0, 10));
  if (from > to) return fail(c, "BAD_RANGE", "시작일이 종료일보다 늦습니다", 400);

  let q = db.from("branches").select("id, name, broj_group_id").not("broj_group_id", "is", null);
  if (body.branch_id) q = q.eq("id", body.branch_id);
  const { data } = await q;
  const mapped = (data as { id: string; name: string; broj_group_id: string }[] | null) ?? [];
  if (mapped.length === 0) return fail(c, "NO_MAPPING", "브로제이 센터가 연결된 지점이 없습니다", 400);

  const branches: { branch_id: string; name: string; ok: boolean; fetched: number; written: number; error?: string }[] = [];
  for (const b of mapped) {
    try {
      const r = await syncAttendance(db, c.env, { branchId: b.id, groupId: b.broj_group_id, from, to });
      branches.push({ branch_id: b.id, name: b.name, ok: true, fetched: r.fetched, written: r.written });
    } catch (e) {
      branches.push({
        branch_id: b.id, name: b.name, ok: false, fetched: 0, written: 0,
        error: e instanceof Error ? e.message : "실패",
      });
    }
  }

  let updated = 0;
  try {
    updated = (await refreshAttendanceStats(db, body.branch_id ?? null)).updated;
  } catch (e) {
    console.error("[broj] refreshAttendanceStats", e);
  }
  // 출석 기록에 딸려온 이용권 정보로 잔여 횟수·비어 있던 만료일도 함께 보완
  let tickets = { sessions: 0, expiry: 0 };
  try {
    tickets = await refreshTicketStats(db, body.branch_id ?? null);
  } catch (e) {
    console.error("[broj] refreshTicketStats", e);
  }

  return ok(c, { from, to, branches, members_updated: updated, sessions_filled: tickets.sessions, expiry_filled: tickets.expiry });
});

/**
 * POST /api/broj/sync/holds — 본사 전용. 홀딩(일시정지) 원본 값 동기화.
 * body: { batch?(기본 50) }. 회원당 1콜이라 조금씩 나눠 돈다(오래된 조회부터).
 * 응답의 remaining 이 0이 될 때까지 반복 호출하면 전원 갱신된다.
 */
brojRoutes.post("/sync/holds", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!HQ_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "본사 관리자만 실행할 수 있습니다", 403);
  if (!hasBrojKey(c.env)) return fail(c, "NO_KEY", "브로제이 API 키가 등록되지 않았습니다", 400);

  const body = await c.req.json<{ batch?: number; branch_id?: string }>()
    .catch(() => ({} as { batch?: number; branch_id?: string }));

  let q = db.from("branches").select("id, name, broj_group_id").not("broj_group_id", "is", null);
  if (body.branch_id) q = q.eq("id", body.branch_id);
  const { data } = await q;
  const mapped = (data as { id: string; name: string; broj_group_id: string }[] | null) ?? [];
  if (mapped.length === 0) return fail(c, "NO_MAPPING", "브로제이 센터가 연결된 지점이 없습니다", 400);

  const branches: { branch_id: string; name: string; ok: boolean; checked: number; holding: number; remaining: number; error?: string }[] = [];
  for (const b of mapped) {
    try {
      const r = await syncMemberHolds(db, c.env, { branchId: b.id, groupId: b.broj_group_id, batch: body.batch });
      branches.push({ branch_id: b.id, name: b.name, ok: true, checked: r.checked, holding: r.holding, remaining: r.remaining });
    } catch (e) {
      branches.push({
        branch_id: b.id, name: b.name, ok: false, checked: 0, holding: 0, remaining: 0,
        error: e instanceof Error ? e.message : "실패",
      });
    }
  }
  return ok(c, { branches });
});

/**
 * POST /api/broj/fill-payments — 본사 전용.
 * 이미 가져온 매출로 회원 결제금액만 다시 채운다(브로제이 재호출 없음, 멱등).
 */
brojRoutes.post("/fill-payments", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!HQ_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "본사 관리자만 실행할 수 있습니다", 403);

  const body = await c.req.json<{ branch_id?: string }>().catch(() => ({} as { branch_id?: string }));
  try {
    const r = await fillPaymentAmounts(db, body.branch_id ?? null);
    return ok(c, r);
  } catch (e) {
    return fail(c, "FILL_FAIL", e instanceof Error ? e.message : "결제금액 채우기 실패", 500);
  }
});

/**
 * GET /api/broj/sync-runs — 최근 동기화 이력.
 * 본사=전 지점, 지점 계정=본인 지점만. 지점별 '마지막 성공/실패'를 화면에서 보여주는 데 쓴다.
 */
brojRoutes.get("/sync-runs", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);

  const limit = Math.min(Number(c.req.query("limit") ?? 20) || 20, 100);
  let q = db
    .from("broj_sync_runs")
    .select("id, branch_id, kind, mode, status, from_date, to_date, fetched, written, sales_total, error_message, finished_at")
    .order("finished_at", { ascending: false })
    .limit(limit);
  // 지점 계정은 본인 지점만 — 본사만 전 지점 열람
  if (!HQ_ROLES.has(profile.role)) {
    if (!profile.branch_id) return ok(c, { runs: [], branches: [] });
    q = q.eq("branch_id", profile.branch_id);
  }
  const { data, error } = await q;
  if (error) return fail(c, "QUERY_FAIL", error.message, 500);

  // 지점 자동화 on/off 상태도 함께 (본사는 전체, 지점은 본인)
  // ⚠️ 여기서 error 를 삼키면 지점 목록이 조용히 빈 배열이 되어 화면에서 패널이 통째로 사라진다.
  let bq = db.from("branches").select("id, name, broj_group_id, broj_auto_sync").not("broj_group_id", "is", null);
  if (!HQ_ROLES.has(profile.role) && profile.branch_id) bq = bq.eq("id", profile.branch_id);
  const { data: bdata, error: bErr } = await bq;
  if (bErr) return fail(c, "BRANCH_QUERY_FAIL", bErr.message, 500);

  return ok(c, { runs: data ?? [], branches: bdata ?? [] });
});

/**
 * POST /api/broj/auto-toggle — 본사 전용. 지점별 자동 동기화 on/off.
 * 끄면 크론이 그 지점을 건너뛴다(수동 버튼은 그대로 동작).
 */
brojRoutes.post("/auto-toggle", requireJwt, async (c) => {
  const db = getServiceClient(c.env);
  const profile = await getProfile(db, c.get("user").id);
  if (!profile) return fail(c, "FORBIDDEN", "권한이 없습니다", 403);
  if (!HQ_ROLES.has(profile.role)) return fail(c, "FORBIDDEN", "본사 관리자만 변경할 수 있습니다", 403);

  const body = await c.req.json<{ branch_id?: string; enabled?: boolean }>().catch(() => ({} as { branch_id?: string; enabled?: boolean }));
  if (!body.branch_id) return fail(c, "BAD_INPUT", "지점을 지정하세요", 400);
  if (typeof body.enabled !== "boolean") return fail(c, "BAD_INPUT", "설정값이 올바르지 않습니다", 400);

  const { error } = await db.from("branches").update({ broj_auto_sync: body.enabled }).eq("id", body.branch_id);
  if (error) return fail(c, "UPDATE_FAIL", error.message, 500);
  return ok(c, { branch_id: body.branch_id, enabled: body.enabled });
});

// (매출 진단 라우트 /debug/sales · /debug/groups 는 원인 규명 완료 후 제거함 — 2026-07-28)
// (진단 라우트 /debug/* 는 원인 규명·매핑 확정 후 전부 제거함 — 2026-07-28)

/**
 * FC-1: 얼굴 출석 API — 키오스크(브라우저 온디바이스 인식)가 호출.
 * 인증: x-kiosk-key = internal_config.face_kiosk_key (DB 내부키, 시크릿 아님)
 * 원칙: 사진 없음(128-d 특징값만), 동의 없인 등록 거부(consent_records 기록),
 *       판단은 member_snapshots(이용권 상태·만료일) 기준, 모든 시도를 access_logs 에 기록.
 * PILOT_SOFT: 파일럿 동안 명부에 없는 사람(코치·직원)은 통과시키되 사유를 남긴다.
 */
import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getServiceClient } from "../lib/supabase";
import { openDoorSafe } from "../services/doorRelay";

export const PILOT_SOFT = false; // FC-4 실차단 가동(2026-08-03) — 거절은 denied 실기록 + 키오스크 사유 안내. faceAdmin 배너도 이 값 따름
const onlyDigits = (s: unknown) => String(s ?? "").replace(/[^0-9]/g, "");
const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

export const faceAccessRoutes = new Hono<{ Bindings: Env }>();

faceAccessRoutes.use("*", async (c, next) => {
  const db = getServiceClient(c.env);
  const provided = c.req.header("x-kiosk-key") || "";
  const { data } = await db.from("internal_config").select("value").eq("key", "face_kiosk_key").maybeSingle();
  if (!data?.value || provided !== data.value) {
    return c.json({ success: false, error: { code: "UNAUTHORIZED", message: "키오스크 키가 올바르지 않습니다" } }, 401);
  }
  await next();
});

// 전화번호 → 회원 (등록 1단계)
// FC-5: 회원 3천+ 규모 대응 — 전체 스캔(limit 2000, 잘림 사고)을 버리고
//       뒷 4자리로 서버에서 좁힌 뒤 정규화 정확 대조. 하이픈 유무 모두 잡힌다.
//       같은 번호가 여러 지점에 있으면 최근 생성 회원(최근 등록 지점) 우선.
faceAccessRoutes.post("/lookup", async (c) => {
  const db = getServiceClient(c.env);
  const body = await c.req.json().catch(() => ({}));
  const phone = onlyDigits(body?.phone);
  if (phone.length < 10) return c.json({ success: false, error: { code: "BAD_PHONE", message: "전화번호 형식 오류" } }, 400);
  const { data: rows } = await db.from("members")
    .select("id, name, branch_id, phone")
    .is("deleted_at", null)
    .ilike("phone", `%${phone.slice(-4)}`)
    .order("created_at", { ascending: false })
    .limit(300);
  const m = (rows || []).find((r) => onlyDigits(r.phone) === phone);
  if (!m) return c.json({ success: false, error: { code: "NOT_FOUND", message: "회원을 찾지 못했습니다" } }, 404);
  const { count } = await db.from("face_profiles").select("id", { count: "exact", head: true })
    .eq("member_id", m.id).eq("active", true);
  return c.json({ success: true, data: { member_id: m.id, name: m.name, branch_id: m.branch_id, enrolled: (count ?? 0) > 0 } });
});

// 임베딩 등록 (동의 필수 → consent_records 에도 기록)
faceAccessRoutes.post("/enroll", async (c) => {
  const db = getServiceClient(c.env);
  const body = await c.req.json().catch(() => ({}));
  const memberId = String(body?.member_id || "");
  const embs = body?.embeddings as number[][] | undefined;
  if (!memberId || !Array.isArray(embs) || embs.length === 0 || embs.length > 5)
    return c.json({ success: false, error: { code: "BAD_INPUT", message: "입력 오류" } }, 400);
  if (body?.consent !== true)
    return c.json({ success: false, error: { code: "CONSENT_REQUIRED", message: "생체정보 수집·이용 동의가 필요합니다" } }, 400);
  if (embs.some((e) => !Array.isArray(e) || e.length !== 128 || e.some((v) => typeof v !== "number" || !isFinite(v))))
    return c.json({ success: false, error: { code: "BAD_EMBEDDING", message: "임베딩 형식 오류" } }, 400);
  // 검수 반영: 존재하는(미삭제) 회원인지 확인 — 유령 명단 행 방지
  const { data: em } = await db.from("members").select("id").eq("id", memberId).is("deleted_at", null).maybeSingle();
  if (!em) return c.json({ success: false, error: { code: "NOT_FOUND", message: "회원을 찾을 수 없습니다" } }, 404);
  await db.from("face_profiles").update({ active: false }).eq("member_id", memberId).eq("active", true);
  const now = new Date().toISOString();
  const { error } = await db.from("face_profiles")
    .insert(embs.map((e) => ({ member_id: memberId, embedding: e, consent_at: now })));
  if (error) return c.json({ success: false, error: { code: "DB", message: "등록 실패" } }, 500);
  await db.from("consent_records").insert({ member_id: memberId, consent_type: "face_recognition", agreed: true, agreed_at: now });
  return c.json({ success: true, data: { saved: embs.length } });
});

// 매칭용 목록 (키오스크가 메모리에 들고 현장 매칭)
// 검수 반영: 조회 실패는 빈 명단으로 위장하지 않고 오류로 알린다. 삭제(deleted_at) 회원 임베딩은 제외.
faceAccessRoutes.post("/list", async (c) => {
  const db = getServiceClient(c.env);
  const { data: rows, error: fpErr } = await db.from("face_profiles")
    .select("member_id, embedding").eq("active", true).limit(3000);
  if (fpErr) return c.json({ success: false, error: { code: "DB", message: "명단 조회 실패" } }, 500);
  // PostgREST 전역 상한(현재 1000행)에 걸리면 오류 없이 잘린다 — 등록자가 조용히 사라지는
  // 사고를 막기 위해 상한 도달을 로그로 남긴다(검수 반영). 근본 해결은 range() 페이징.
  if ((rows || []).length >= 1000) console.error("[face/list] 명단 절단 의심 — 페이징 전환 필요:", (rows || []).length);
  const ids = [...new Set((rows || []).map((r) => r.member_id))];
  const nameMap = new Map<string, string>();
  if (ids.length) {
    const { data: ms, error: msErr } = await db.from("members")
      .select("id, name").in("id", ids).is("deleted_at", null);
    if (msErr) return c.json({ success: false, error: { code: "DB", message: "명단 조회 실패" } }, 500);
    for (const m of ms || []) nameMap.set(m.id, (m.name || "회원").trim());
  }
  return c.json({ success: true, data: { profiles: (rows || [])
    .filter((r) => nameMap.has(r.member_id))
    .map((r) => ({ member_id: r.member_id, name: nameMap.get(r.member_id) || "회원", embedding: r.embedding })) } });
});

// 출입 판단 + access_logs 기록 (153OS 핵심 — 만료·미납 자동 판정)
faceAccessRoutes.post("/verify", async (c) => {
  const db = getServiceClient(c.env);
  const body = await c.req.json().catch(() => ({}));
  const memberId = String(body?.member_id || "");
  if (!memberId) return c.json({ success: false, error: { code: "BAD_INPUT", message: "member_id 필요" } }, 400);
  // 검수 반영: 삭제 회원을 404 로 끊으면 access_logs 에 한 줄도 안 남아 감사 공백이 된다.
  // 삭제 여부를 함께 읽어 "거절 + 기록" 으로 처리한다(키오스크도 네트워크 오류가 아닌 거절로 안내).
  const { data: m } = await db.from("members")
    .select("id, name, phone, branch_id, company_id, status, ranking_app_user_id, deleted_at")
    .eq("id", memberId).maybeSingle();
  if (!m) return c.json({ success: false, error: { code: "NOT_FOUND", message: "회원 없음" } }, 404);
  if (m.deleted_at) {
    const { error: delLogErr } = await db.from("access_logs").insert({
      branch_id: m.branch_id, company_id: m.company_id, member_id: m.id,
      credential_type: "face", result: "denied", denied_reason: "unknown_user",
      occurred_at: new Date().toISOString(),
    });
    if (delLogErr) console.error("[face/verify] access_logs insert 실패(deleted member)", delLogErr);
    return c.json({ success: true, data: { allowed: false, reason: "unknown_user", name: m.name, end_date: null, app_user_id: null } });
  }

  // 검수 반영(FC-4): 등록 해제(동의 철회) 회원은 켜져 있는 키오스크 RAM 명단에 남아 있어도
  // 서버가 최종 차단한다 — "데스크 요청 시 즉시 삭제" 약속의 서버측 방어선.
  const { count: activeShots } = await db.from("face_profiles")
    .select("id", { count: "exact", head: true })
    .eq("member_id", m.id).eq("active", true);
  if ((activeShots ?? 0) === 0) {
    const { error: revLogErr } = await db.from("access_logs").insert({
      branch_id: m.branch_id, company_id: m.company_id, member_id: m.id,
      credential_type: "face", result: "denied", denied_reason: "consent_revoked",
      occurred_at: new Date().toISOString(),
    });
    if (revLogErr) console.error("[face/verify] access_logs insert 실패(consent_revoked)", revLogErr);
    return c.json({ success: true, data: { allowed: false, reason: "consent_revoked", name: m.name, end_date: null, app_user_id: null } });
  }

  // FC-4: 직원·관리자 권한(access_grants staff/admin_override) 우선 확인 —
  // 관장·코치는 명부(이용권)와 무관하게 통과한다. 실차단(PILOT_SOFT=false) 전환의 전제 조건.
  // 감사 기록엔 raw_event_id 로 grant 통과를 구분해 남긴다.
  const nowMs = Date.now();
  const { data: grants } = await db.from("access_grants")
    .select("id, grant_type, valid_from, valid_until")
    .eq("member_id", m.id)
    .eq("status", "active")
    .in("grant_type", ["staff", "admin_override"])
    .limit(5);
  const staffGrant = (grants || []).find((g) => {
    const from = new Date(g.valid_from).getTime();
    const until = g.valid_until ? new Date(g.valid_until).getTime() : Infinity;
    return Number.isFinite(from) && from <= nowMs && until >= nowMs;
  });
  if (staffGrant) {
    const { error: staffLogErr } = await db.from("access_logs").insert({
      branch_id: m.branch_id, company_id: m.company_id, member_id: m.id,
      credential_type: "face", result: "success", denied_reason: null,
      raw_event_id: `staff_grant:${staffGrant.id}`, occurred_at: new Date().toISOString(),
    });
    if (staffLogErr) console.error("[face/verify] access_logs insert 실패(staff)", staffLogErr);
    c.executionCtx.waitUntil(openDoorSafe(c.env, m.branch_id)); // 문 열기(설정 시) — 응답 지연 없음
    return c.json({ success: true, data: { allowed: true, reason: null, staff: true, name: m.name, end_date: null, app_user_id: m.ranking_app_user_id ?? null } });
  }

  // 검수 반영(boxer): CRM 원장(members.status)의 정지·미납·탈퇴는 스냅샷과 무관하게 차단 —
  // CLAUDE.md 핵심목적 1(미납 자동 차단)·필수원칙 6(정지 차단). 스냅샷(브로제이 명부)의
  // memberStatus()는 유효/만료/미상만 생산해 '정지·미납' 신호가 없으므로 members.status 가 유일한 차단 신호다.
  // PILOT_SOFT 완화 대상이 아님(삭제·동의철회와 동일한 하드 차단).
  const STATUS_BLOCK: Record<string, string> = {
    suspended: "suspended",
    unpaid: "unpaid",
    withdrawn: "unknown_user",
  };
  const statusBlock = STATUS_BLOCK[String(m.status)];
  if (statusBlock) {
    const { error: stLogErr } = await db.from("access_logs").insert({
      branch_id: m.branch_id, company_id: m.company_id, member_id: m.id,
      credential_type: "face", result: "denied", denied_reason: statusBlock,
      occurred_at: new Date().toISOString(),
    });
    if (stLogErr) console.error("[face/verify] access_logs insert 실패(status block)", stLogErr);
    return c.json({ success: true, data: { allowed: false, reason: statusBlock, name: m.name, end_date: null, app_user_id: m.ranking_app_user_id ?? null } });
  }

  // 이용권 판단 — member_snapshots(브로제이 명부, (지점,전화) 키)가 실질 원장
  let allowed = false; let reason: string | null = null; let endDate: string | null = null;
  let unknownLedger = false; // 원장에 상태·만료일이 전혀 없는데 통과한 경우(감사 표식용)
  const phone = onlyDigits(m.phone);
  if (phone.length >= 10) {
    const { data: snaps } = await db.from("member_snapshots")
      .select("status, end_date").eq("branch_id", m.branch_id).eq("normalized_phone", phone).limit(1);
    const s = snaps?.[0];
    if (s) {
      endDate = s.end_date ?? null;
      const notExpiredByDate = !s.end_date || String(s.end_date) >= kstToday();
      // 검수 반영: '미납' 도 방어적으로 차단 목록에 포함(스냅샷 소스가 미납 표기를 추가할 경우 대비)
      const badStatus = typeof s.status === "string" && /만료|정지|환불|탈퇴|미납/.test(s.status);
      if (notExpiredByDate && !badStatus) {
        allowed = true;
        // end_date 도 없고 status 도 미입력/미상이면 "원장 근거 없는 통과" — 거절로 바꾸진 않되(유효 회원 오차단 방지) 감사 표식을 남긴다
        unknownLedger = !s.end_date && (!s.status || /미입력|미상/.test(String(s.status)));
      }
      else { reason = "expired_membership"; }
    } else {
      reason = "no_valid_grant";
    }
  } else {
    reason = "unknown_user";
  }
  if (!allowed && PILOT_SOFT) {
    // 파일럿: 차단 대신 통과 + 사유 보존 (문 제어 전 단계라 표시용)
    allowed = true;
  }
  const { error: logErr } = await db.from("access_logs").insert({
    branch_id: m.branch_id, company_id: m.company_id, member_id: m.id,
    // result 는 최종 판정(allowed) 기준으로 적는다 — 사유(reason)로 적으면 파일럿 완화 시
    // "success + 거절사유" 같은 모순 행이 남아 리포트 해석이 갈린다(검수 반영).
    credential_type: "face", result: allowed ? "success" : "denied",
    denied_reason: allowed ? null : reason,
    // 파일럿 완화로 통과시킨 경우 사유는 raw_event_id 에 보존(감사용, 집계 오염 없음)
    // 원장 근거 없는 통과(미입력·미상 + end_date null)도 unknown_ledger 로 표식(운영 모니터링용)
    raw_event_id: allowed && reason ? `pilot_soft:${reason}` : allowed && unknownLedger ? "unknown_ledger" : null,
    occurred_at: new Date().toISOString(),
  });
  if (logErr) console.error("[face/verify] access_logs insert 실패", logErr);
  if (allowed) c.executionCtx.waitUntil(openDoorSafe(c.env, m.branch_id)); // 문 열기(설정 시)
  return c.json({ success: true, data: { allowed, reason, name: m.name, end_date: endDate, app_user_id: m.ranking_app_user_id ?? null } });
});

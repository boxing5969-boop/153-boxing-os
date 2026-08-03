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

export const PILOT_SOFT = true; // faceAdmin(관리 화면)도 참조 — 해제 시 실차단 전환(FC-4)
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
faceAccessRoutes.post("/lookup", async (c) => {
  const db = getServiceClient(c.env);
  const body = await c.req.json().catch(() => ({}));
  const phone = onlyDigits(body?.phone);
  if (phone.length < 10) return c.json({ success: false, error: { code: "BAD_PHONE", message: "전화번호 형식 오류" } }, 400);
  const { data: rows } = await db.from("members")
    .select("id, name, branch_id, phone").not("phone", "is", null).limit(2000);
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
  await db.from("face_profiles").update({ active: false }).eq("member_id", memberId).eq("active", true);
  const now = new Date().toISOString();
  const { error } = await db.from("face_profiles")
    .insert(embs.map((e) => ({ member_id: memberId, embedding: e, consent_at: now })));
  if (error) return c.json({ success: false, error: { code: "DB", message: "등록 실패" } }, 500);
  await db.from("consent_records").insert({ member_id: memberId, consent_type: "face_recognition", agreed: true, agreed_at: now });
  return c.json({ success: true, data: { saved: embs.length } });
});

// 매칭용 목록 (키오스크가 메모리에 들고 현장 매칭)
faceAccessRoutes.post("/list", async (c) => {
  const db = getServiceClient(c.env);
  const { data: rows } = await db.from("face_profiles").select("member_id, embedding").eq("active", true).limit(3000);
  const ids = [...new Set((rows || []).map((r) => r.member_id))];
  const nameMap = new Map<string, string>();
  if (ids.length) {
    const { data: ms } = await db.from("members").select("id, name").in("id", ids);
    for (const m of ms || []) nameMap.set(m.id, (m.name || "회원").trim());
  }
  return c.json({ success: true, data: { profiles: (rows || []).map((r) => ({
    member_id: r.member_id, name: nameMap.get(r.member_id) || "회원", embedding: r.embedding })) } });
});

// 출입 판단 + access_logs 기록 (153OS 핵심 — 만료·미납 자동 판정)
faceAccessRoutes.post("/verify", async (c) => {
  const db = getServiceClient(c.env);
  const body = await c.req.json().catch(() => ({}));
  const memberId = String(body?.member_id || "");
  if (!memberId) return c.json({ success: false, error: { code: "BAD_INPUT", message: "member_id 필요" } }, 400);
  const { data: m } = await db.from("members")
    .select("id, name, phone, branch_id, company_id, status, ranking_app_user_id").eq("id", memberId).maybeSingle();
  if (!m) return c.json({ success: false, error: { code: "NOT_FOUND", message: "회원 없음" } }, 404);

  // 이용권 판단 — member_snapshots(브로제이 명부, (지점,전화) 키)가 실질 원장
  let allowed = false; let reason: string | null = null; let endDate: string | null = null;
  const phone = onlyDigits(m.phone);
  if (phone.length >= 10) {
    const { data: snaps } = await db.from("member_snapshots")
      .select("status, end_date").eq("branch_id", m.branch_id).eq("normalized_phone", phone).limit(1);
    const s = snaps?.[0];
    if (s) {
      endDate = s.end_date ?? null;
      const notExpiredByDate = !s.end_date || String(s.end_date) >= kstToday();
      const badStatus = typeof s.status === "string" && /만료|정지|환불|탈퇴/.test(s.status);
      if (notExpiredByDate && !badStatus) { allowed = true; }
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
  await db.from("access_logs").insert({
    branch_id: m.branch_id, company_id: m.company_id, member_id: m.id,
    credential_type: "face", result: reason ? (PILOT_SOFT ? "success" : "denied") : "success",
    denied_reason: reason, occurred_at: new Date().toISOString(),
  });
  return c.json({ success: true, data: { allowed, reason, name: m.name, end_date: endDate, app_user_id: m.ranking_app_user_id ?? null } });
});

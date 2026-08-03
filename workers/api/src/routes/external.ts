import { Hono } from "hono";
import type { Env } from "../lib/env";
import { fail, ok } from "../lib/responses";
import { requirePartnerAuth } from "../middleware/partnerAuth";
import { getServiceClient } from "../lib/supabase";
import { getPaymentProvider, getPaymentContext } from "../services/payment";
import { calcRefund, buildMemberMessage, todayKst, type RefundInput } from "../lib/refundCalc";
import { generateQrToken } from "../services/qrToken";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const externalRoutes = new Hono<{ Bindings: Env }>();

/** 153복싱짐 선릉(역)점 — 마이복서 가입 기본 지점 */
const DEFAULT_BRANCH_ID = "5a4e9165-38b6-4e4e-8e6d-62d5cf1ce850";

interface MemberRow {
  id: string;
  branch_id: string;
  name: string;
  status: string;
}

async function loadMember(
  db: SupabaseClient,
  rankingId: string
): Promise<MemberRow | null> {
  const { data } = await db
    .from("members")
    .select("id, branch_id, name, status")
    .eq("ranking_app_user_id", rankingId)
    .maybeSingle();
  return (data as MemberRow | null) ?? null;
}

interface MembershipRow {
  id: string;
  plan_name: string;
  start_date: string;
  end_date: string;
  status: string;
  payment_status: string;
}

interface TrialRow {
  id: string;
  start_at: string;
  end_at: string;
  max_entries: number;
  used_entries: number;
  status: string;
}

externalRoutes.get("/me/membership", requirePartnerAuth, async (c) => {
  const db = getServiceClient(c.env);
  const member = await loadMember(db, c.get("rankingUserId"));
  if (!member) {
    return fail(c, "NOT_REGISTERED", "랭킹업 사용자가 153 회원과 연결되지 않았습니다", 404);
  }

  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  const [memberships, trials] = await Promise.all([
    db
      .from("memberships")
      .select("id,plan_name,start_date,end_date,status,payment_status")
      .eq("member_id", member.id)
      .order("end_date", { ascending: false })
      .limit(5),
    db
      .from("trial_passes")
      .select("id,start_at,end_at,max_entries,used_entries,status")
      .eq("member_id", member.id)
      .order("end_at", { ascending: false })
      .limit(5),
  ]);

  const ms = (memberships.data ?? []) as unknown as MembershipRow[];
  const tp = (trials.data ?? []) as unknown as TrialRow[];

  const activeMembership =
    ms.find(
      (m) =>
        m.status === "active" &&
        m.end_date >= today &&
        (m.payment_status === "paid" || m.payment_status === "partial")
    ) ?? null;
  const activeTrial =
    tp.find(
      (t) =>
        t.status === "active" &&
        t.end_at >= nowIso &&
        t.used_entries < t.max_entries
    ) ?? null;

  let canEnterReason: string | null = null;
  if (!activeMembership && !activeTrial) {
    if (member.status === "expired") canEnterReason = "expired_membership";
    else if (member.status === "unpaid") canEnterReason = "unpaid";
    else if (member.status === "suspended") canEnterReason = "suspended";
    else if (member.status === "withdrawn") canEnterReason = "unknown_user";
    else canEnterReason = "no_valid_grant";
  }

  return ok(c, {
    member: { id: member.id, name: member.name, status: member.status },
    branch_id: member.branch_id,
    can_enter: !!(activeMembership || activeTrial),
    cannot_enter_reason: canEnterReason,
    active_membership: activeMembership,
    active_trial: activeTrial,
    memberships: ms,
    trials: tp,
  });
});

externalRoutes.post("/me/qr", requirePartnerAuth, async (c) => {
  const db = getServiceClient(c.env);
  const member = await loadMember(db, c.get("rankingUserId"));
  if (!member) {
    return fail(c, "NOT_REGISTERED", "랭킹업 사용자가 153 회원과 연결되지 않았습니다", 404);
  }
  if (!c.env.QR_SIGNING_SECRET) {
    return fail(c, "INTERNAL_ERROR", "QR_SIGNING_SECRET 미설정", 500);
  }

  const { token, expires_at } = await generateQrToken(
    c.env.QR_SIGNING_SECRET,
    member.id,
    member.branch_id
  );
  return ok(c, {
    qr_token: token,
    expires_at: new Date(expires_at * 1000).toISOString(),
    ttl_seconds: 60,
  });
});

externalRoutes.get("/me/access-logs", requirePartnerAuth, async (c) => {
  const db = getServiceClient(c.env);
  const member = await loadMember(db, c.get("rankingUserId"));
  if (!member) {
    return fail(c, "NOT_REGISTERED", "회원 미연결", 404);
  }

  const rawLimit = parseInt(c.req.query("limit") ?? "20", 10);
  const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? 20 : rawLimit, 1), 100);

  const { data } = await db
    .from("access_logs")
    .select("id,credential_type,result,denied_reason,occurred_at,branch_id")
    .eq("member_id", member.id)
    .order("occurred_at", { ascending: false })
    .limit(limit);

  return ok(c, { logs: data ?? [] });
});

externalRoutes.get("/me/levels", requirePartnerAuth, async (c) => {
  const db = getServiceClient(c.env);
  const member = await loadMember(db, c.get("rankingUserId"));
  if (!member) {
    return fail(c, "NOT_REGISTERED", "회원 미연결", 404);
  }

  const { data } = await db
    .from("level_progress")
    .select("tier,level,status,tested_at,approved_by")
    .eq("member_id", member.id)
    .order("tier")
    .order("level");

  return ok(c, { levels: data ?? [] });
});

// ── Phase 8 추가 엔드포인트 ────────────────────────────────

/** GET /api/external/me/profile — 회원 기본 프로필 */
externalRoutes.get("/me/profile", requirePartnerAuth, async (c) => {
  const db = getServiceClient(c.env);
  const member = await loadMember(db, c.get("rankingUserId"));
  if (!member) return fail(c, "NOT_REGISTERED", "회원 미연결", 404);

  const { data } = await db
    .from("members")
    .select("id,name,phone,birth_date,gender,status,created_at,branches(name)")
    .eq("id", member.id)
    .maybeSingle();

  return ok(c, data ?? {});
});

/** GET /api/external/me/body-measurements — 체성분 기록 */
externalRoutes.get("/me/body-measurements", requirePartnerAuth, async (c) => {
  const db = getServiceClient(c.env);
  const member = await loadMember(db, c.get("rankingUserId"));
  if (!member) return fail(c, "NOT_REGISTERED", "회원 미연결", 404);

  const rawLimit = parseInt(c.req.query("limit") ?? "20", 10);
  const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? 20 : rawLimit, 1), 50);

  const { data } = await db
    .from("body_measurements")
    .select("id,measured_at,weight_kg,body_fat_pct,muscle_mass_kg,bmi")
    .eq("member_id", member.id)
    .order("measured_at", { ascending: false })
    .limit(limit);

  return ok(c, { measurements: data ?? [] });
});

/** GET /api/external/me/workouts — 운동 일지 */
externalRoutes.get("/me/workouts", requirePartnerAuth, async (c) => {
  const db = getServiceClient(c.env);
  const member = await loadMember(db, c.get("rankingUserId"));
  if (!member) return fail(c, "NOT_REGISTERED", "회원 미연결", 404);

  const rawLimit = parseInt(c.req.query("limit") ?? "20", 10);
  const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? 20 : rawLimit, 1), 50);

  const { data } = await db
    .from("workout_logs")
    .select("id,logged_date,duration_min,intensity,note")
    .eq("member_id", member.id)
    .order("logged_date", { ascending: false })
    .limit(limit);

  return ok(c, { workouts: data ?? [] });
});

// ── 회원가입(신규 등록) — 마이복서앱 트리거 ──────────────────

const registerSchema = z.object({
  name: z.string().trim().min(1).max(40),
  phone: z.string().trim().min(9).max(20),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  branch_id: z.string().uuid().optional(),
  agree_privacy: z.boolean(),
  agree_terms: z.boolean(),
  agree_marketing: z.boolean().optional(),
});

/**
 * POST /api/external/me/register — 마이복서 회원이 153 회원으로 신규 등록.
 *  · 앱유저ID/전화 매칭으로 멱등(기존 회원이면 연결, 중복 생성 안 함)
 *  · 신규는 체험(trial) + 상담리드(visitor_requests) + 동의기록
 */
externalRoutes.post("/me/register", requirePartnerAuth, async (c) => {
  const parsed = registerSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return fail(c, "INVALID_REQUEST", "필수 입력값(이름·전화·동의)을 확인해주세요", 400);
  }
  const b = parsed.data;
  if (!b.agree_privacy || !b.agree_terms) {
    return fail(c, "CONSENT_REQUIRED", "개인정보·이용약관 동의가 필요합니다", 400);
  }

  const db = getServiceClient(c.env);
  const { data, error } = await db.rpc("app_register_member", {
    _ranking_user_id: c.get("rankingUserId"),
    _branch_id: b.branch_id ?? DEFAULT_BRANCH_ID,
    _name: b.name,
    _phone: b.phone,
    _birth: b.birth_date ?? null,
    _gender: b.gender ?? null,
    _agree_privacy: b.agree_privacy,
    _agree_terms: b.agree_terms,
    _agree_marketing: b.agree_marketing ?? false,
  });

  if (error) {
    const msg = error.message || "회원가입 처리에 실패했습니다";
    const code = msg.includes("CONSENT")
      ? "CONSENT_REQUIRED"
      : msg.includes("BRANCH")
        ? "BRANCH_NOT_FOUND"
        : "REGISTER_FAILED";
    return fail(c, code, msg, 400);
  }

  const m = data as unknown as {
    id: string;
    name: string;
    status: string;
    branch_id: string;
  };
  return ok(
    c,
    { member: { id: m.id, name: m.name, status: m.status, branch_id: m.branch_id }, registered: true },
    "회원 등록 완료",
    201
  );
});

/**
 * POST /api/external/me/face — 얼굴 등록 요청(안면인식 출입).
 *  · 안면인식 동의 기록 + 지점 단말기에 create_user 동기화 작업 큐잉
 *  · 실제 얼굴 이미지는 CRM 에 저장하지 않고 단말기(브로제이)로 전달(어댑터)
 *  · 단말기 미연동 시 동의만 기록하고 대기 상태로 응답
 */
externalRoutes.post("/me/face", requirePartnerAuth, async (c) => {
  const db = getServiceClient(c.env);
  const member = await loadMember(db, c.get("rankingUserId"));
  if (!member) return fail(c, "NOT_REGISTERED", "먼저 회원가입이 필요합니다", 404);

  // 1) 안면인식 동의
  await db
    .from("consent_records")
    .insert({ member_id: member.id, consent_type: "face_recognition", agreed: true });

  // 2) 지점 안면인식 단말기 조회
  const { data: device } = await db
    .from("access_devices")
    .select("id, vendor")
    .eq("branch_id", member.branch_id)
    .eq("device_type", "face_terminal")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (!device) {
    return ok(c, { face_consent: true, queued: false }, "얼굴 등록 접수 — 출입 단말기 연동 대기");
  }
  const dev = device as { id: string; vendor: string };

  // 3) 단말기 사용자 매핑 + create_user 동기화 작업 큐잉(어댑터가 처리)
  await db.from("device_users").upsert(
    { member_id: member.id, device_id: dev.id, vendor_user_id: member.id, status: "pending_sync" },
    { onConflict: "device_id,vendor_user_id" }
  );
  const { data: job } = await db
    .from("device_sync_jobs")
    .insert({
      branch_id: member.branch_id,
      device_id: dev.id,
      job_type: "create_user",
      target_member_id: member.id,
      status: "pending",
    })
    .select("id")
    .single();

  return ok(
    c,
    { face_consent: true, queued: true, vendor: dev.vendor, sync_job_id: (job as { id: string } | null)?.id ?? null },
    dev.vendor === "broj" ? "얼굴 등록 요청 — 브로제이 동기화 대기" : "얼굴 등록 요청 — 동기화 대기"
  );
});


// ── 외부결제(마이복서 결제선생) 동기화 ───────────────────────

const syncPaidSchema = z.object({
  ext_order_id: z.string().trim().min(1).max(120),
  plan_name: z.string().trim().min(1).max(80),
  amount: z.number().int().min(0).max(99999999),
  months: z.number().int().min(0).max(36),
  name: z.string().trim().max(40).optional(),
  phone: z.string().trim().max(20).optional(),
  branch_id: z.string().uuid().optional(),
});

/**
 * POST /api/external/me/sync-paid — 마이복서 결제선생 결제 성공을 153OS 로 동기화.
 *  · 외부주문ID(ext_order_id)로 멱등 — 회원 확보 + 회원권 active/paid + 출입권한 + 단말기 동기화.
 *  · 마이복서 payssam-callback(서버)에서 호출. 호출측에서 실패해도 결제엔 영향 없게 비차단 처리.
 */
externalRoutes.post("/me/sync-paid", requirePartnerAuth, async (c) => {
  const parsed = syncPaidSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return fail(c, "INVALID_REQUEST", "결제 동기화 입력값을 확인해주세요", 400);
  }
  const b = parsed.data;
  const db = getServiceClient(c.env);
  const { data, error } = await db.rpc("app_sync_paid_membership", {
    _ranking_user_id: c.get("rankingUserId"),
    _branch_id: b.branch_id ?? DEFAULT_BRANCH_ID,
    _name: b.name ?? "회원",
    _phone: b.phone ?? null,
    _plan_name: b.plan_name,
    _amount: b.amount,
    _months: b.months,
    _ext_order_id: b.ext_order_id,
  });
  if (error) {
    return fail(c, "SYNC_FAILED", error.message || "결제 동기화에 실패했습니다", 400);
  }
  const r = data as { member_id: string; membership_id: string; idempotent: boolean };
  return ok(
    c,
    { member_id: r.member_id, membership_id: r.membership_id, idempotent: r.idempotent },
    r.idempotent ? "이미 동기화됨" : "결제 동기화 완료",
    r.idempotent ? 200 : 201
  );
});


// ── 체크아웃·홀딩 — 회원 셀프서비스 ──────────────────────────

const checkoutSchema = z.object({
  product_name: z.string().trim().min(1).max(60),
  amount: z.number().int().min(0).max(99999999),
  months: z.number().int().min(0).max(36),
  purpose: z.enum(["new_membership", "renewal", "pt", "product", "other"]).optional(),
});

/**
 * POST /api/external/me/checkout — 이용권 결제요청 생성.
 *  · payment_request 생성 → 결제 어댑터로 청구서 발송(현재 mock) → 결제링크 반환
 *  · 결제 성공 콜백(/api/payments/callback)에서 회원권 자동 활성
 */
externalRoutes.post("/me/checkout", requirePartnerAuth, async (c) => {
  const parsed = checkoutSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "상품·금액을 확인해주세요", 400);
  const b = parsed.data;
  const db = getServiceClient(c.env);
  const member = await loadMember(db, c.get("rankingUserId"));
  if (!member) return fail(c, "NOT_REGISTERED", "먼저 회원가입이 필요합니다", 404);

  const { data, error } = await db.rpc("app_checkout", {
    _member_id: member.id,
    _product_name: b.product_name,
    _amount: b.amount,
    _months: b.months,
    _purpose: b.purpose ?? "new_membership",
  });
  if (error) return fail(c, "CHECKOUT_FAILED", error.message, 400);
  const r = data as { payment_request_id: string };

  const provider = getPaymentProvider(c.env);
  const ctx = getPaymentContext(c.env);
  const origin = new URL(c.req.url).origin;
  try {
    const bill = await provider.createBill(ctx, {
      bill_id: r.payment_request_id,
      amount: b.amount,
      member_name: member.name,
      member_phone: "",
      product_name: b.product_name,
      callback_url: `${origin}/api/payments/callback`,
    });
    await db
      .from("payment_requests")
      .update({
        provider: bill.provider,
        provider_ref: bill.provider_ref,
        payment_link: bill.payment_link,
        status: "sent",
        updated_at: new Date().toISOString(),
      })
      .eq("id", r.payment_request_id);
    return ok(
      c,
      { payment_request_id: r.payment_request_id, payment_link: bill.payment_link, provider: bill.provider, amount: b.amount },
      "결제요청 생성",
      201
    );
  } catch (e) {
    return ok(
      c,
      { payment_request_id: r.payment_request_id, payment_link: null, pending: true, note: e instanceof Error ? e.message : "청구 발송 대기" },
      "결제요청 생성(청구 발송 대기)",
      201
    );
  }
});

const holdSchema = z.object({
  hold_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hold_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * POST /api/external/me/hold-request — 홀딩(일시정지) 신청.
 *  · 권별 정책 자동가드(1개월7일·3개월15일·5개월30일·12개월 60일/2회)
 *  · 통과 시 회원권 일시정지 + 만료일 연장 + 출입 정지(자동 동기화)
 */
externalRoutes.post("/me/hold-request", requirePartnerAuth, async (c) => {
  const parsed = holdSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "INVALID_REQUEST", "홀딩 기간(YYYY-MM-DD)을 확인해주세요", 400);
  const b = parsed.data;
  const db = getServiceClient(c.env);
  const member = await loadMember(db, c.get("rankingUserId"));
  if (!member) return fail(c, "NOT_REGISTERED", "먼저 회원가입이 필요합니다", 404);

  const { data, error } = await db.rpc("app_request_hold", {
    _member_id: member.id,
    _hold_start: b.hold_start,
    _hold_end: b.hold_end,
  });
  if (error) {
    const msg = error.message || "홀딩 신청 실패";
    const code = msg.includes("COUNT")
      ? "HOLD_COUNT_EXCEEDED"
      : msg.includes("DAYS")
        ? "HOLD_DAYS_EXCEEDED"
        : msg.includes("ALREADY")
          ? "ALREADY_ON_HOLD"
          : msg.includes("NO_ACTIVE")
            ? "NO_ACTIVE_MEMBERSHIP"
            : "HOLD_FAILED";
    return fail(c, code, msg, 400);
  }
  return ok(c, data, "홀딩 적용 완료");
});


// ── 환불 신청(규정 자동계산) — 회원 셀프서비스 ─────────────────

const refundSchema = z.object({
  membership_id: z.string().uuid().optional(),
  reason: z.enum(["소비자", "센터", "기타"]).optional(),
});

/**
 * POST /api/external/me/refund-request — 환불 신청(규정 자동계산).
 *  · 회원권 기반 입력 도출(수강료=결제금액, 일할 사용분, 위약금 기본 10%) → calcRefund
 *  · refund_requests 생성(상태 requested). 실제 환불(카드취소/계좌)은 결제선생 연동 후/관장 처리.
 *  · 장비·부대 공제는 회원 셀프에선 미적용(관장이 RefundCalculator로 조정 가능).
 */
externalRoutes.post("/me/refund-request", requirePartnerAuth, async (c) => {
  const parsed = refundSchema.safeParse(await c.req.json().catch(() => ({})));
  const body = parsed.success ? parsed.data : {};
  const db = getServiceClient(c.env);
  const member = await loadMember(db, c.get("rankingUserId"));
  if (!member) return fail(c, "NOT_REGISTERED", "먼저 회원가입이 필요합니다", 404);

  let q = db
    .from("memberships")
    .select("id,plan_name,start_date,end_date,status")
    .eq("member_id", member.id);
  if (body.membership_id) q = q.eq("id", body.membership_id);
  else q = q.in("status", ["active", "paused"]);
  const { data: msRow } = await q.order("end_date", { ascending: false }).limit(1).maybeSingle();
  if (!msRow) return fail(c, "NO_MEMBERSHIP", "환불할 이용권이 없습니다", 404);
  const ms = msRow as { id: string; plan_name: string; start_date: string; end_date: string; status: string };

  const { data: payRow } = await db
    .from("payment_requests")
    .select("amount")
    .eq("membership_id", ms.id)
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const tuition = Number((payRow as { amount: number } | null)?.amount ?? 0);

  const { data: prof } = await db
    .from("members")
    .select("name,phone,branches(name)")
    .eq("id", member.id)
    .maybeSingle();
  const p = prof as { name: string; phone: string | null; branches: { name: string } | null } | null;
  const isSession = /pt|회/i.test(ms.plan_name || "");

  const input: RefundInput = {
    member_name: p?.name ?? member.name,
    phone: p?.phone ?? "",
    branch_name: p?.branches?.name ?? "153복싱짐",
    product_name: ms.plan_name ?? "멤버십",
    contract_type: isSession ? "회차권" : "기간권",
    refund_reason: body.reason ?? "소비자",
    payment_date: ms.start_date,
    start_date: ms.start_date,
    end_date: ms.end_date,
    refund_requested_date: todayKst(),
    payment_amount: tuition,
    tuition_amount: tuition,
    penalty_applied: true,
    penalty_rate: 0.1,
    pay_method: "카드",
    total_sessions: 0,
    used_sessions: 0,
    glove_given: false,
    wrap_given: false,
    equipment_fee: 0,
    equipment_notice_given: false,
    equipment_used: false,
    equipment_hygiene_unreusable: false,
    equipment_returned: false,
    locker_included: false,
    sportswear_included: false,
    paid_separately: false,
    non_refundable_notice: false,
    additional_amount: 0,
    additional_excluded: false,
    rounding_type: "thousand_up",
  };

  const r = calcRefund(input);
  const memberMsg = buildMemberMessage(input, r);

  const { data: ins, error } = await db
    .from("refund_requests")
    .insert({
      branch_id: member.branch_id,
      member_name: input.member_name,
      phone: input.phone || null,
      product_name: input.product_name,
      contract_type: input.contract_type,
      refund_reason_type: input.refund_reason,
      payment_method: input.pay_method,
      payment_date: input.payment_date || null,
      start_date: input.start_date || null,
      end_date: input.end_date || null,
      refund_requested_date: input.refund_requested_date,
      payment_amount: tuition,
      tuition_amount: tuition,
      total_days: r.totalDays,
      elapsed_days: r.elapsedDays,
      remaining_days: r.remainingDays,
      penalty_rate: input.penalty_rate,
      penalty_amount: r.penaltyAmount,
      used_amount: r.usedAmount,
      calculated_refund_amount: r.calculated,
      final_refund_amount: r.final,
      rounding_type: input.rounding_type,
      risk_level: r.riskLevel,
      risk_messages: r.risks,
      member_message: memberMsg,
      refund_status: "requested",
    })
    .select("id")
    .single();
  if (error) return fail(c, "REFUND_REQUEST_FAILED", error.message, 400);

  return ok(
    c,
    {
      refund_request_id: (ins as { id: string }).id,
      tuition,
      used_amount: r.usedAmount,
      penalty_amount: r.penaltyAmount,
      calculated: r.calculated,
      final: r.final,
      risk_level: r.riskLevel,
      member_message: memberMsg,
      note: tuition === 0 ? "결제금액 미확인 — 관장 확인 필요" : "실제 환불은 카드취소/계좌(결제선생 연동 후) 진행",
    },
    "환불 신청 접수(자동계산 완료)",
    201
  );
});


/** GET /api/external/health — 연결 상태 확인 (인증 불필요) */
externalRoutes.get("/health", async (c) => {
  return ok(c, {
    ok: true,
    version: "1.0",
    timestamp: new Date().toISOString(),
  });
});

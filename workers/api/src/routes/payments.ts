import { Hono } from "hono";
import type { Env } from "../lib/env";
import { ok, fail } from "../lib/responses";
import { getServiceClient } from "../lib/supabase";
import { getPaymentProvider } from "../services/payment";

export const paymentsRoutes = new Hono<{ Bindings: Env }>();

interface PaymentRequestRow {
  id: string;
  company_id: string;
  branch_id: string;
  member_id: string | null;
}

/**
 * POST /api/payments/callback — 결제 PG(결제선생) 콜백 수신.
 *  · provider.parseCallback 으로 표준화 → payment_events 멱등 기록(provider+event_id unique)
 *  · 결제선생 연동 전엔 mock provider 가 처리(스텁). 키 오면 PayssamProvider 가 채워짐.
 *  · 실제 회원권 활성/환불 반영은 Phase 2(체크아웃 연동)에서 확장.
 */
paymentsRoutes.post("/callback", async (c) => {
  const raw = await c.req.text().catch(() => "");
  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((v, k) => {
    headers[k] = v;
  });

  const provider = getPaymentProvider(c.env);
  let ev;
  try {
    ev = provider.parseCallback(raw, headers);
  } catch (e) {
    return fail(
      c,
      "CALLBACK_UNSUPPORTED",
      e instanceof Error ? e.message : "콜백 파싱 실패",
      501
    );
  }

  const db = getServiceClient(c.env);

  // provider_ref 로 결제요청 매칭(있을 때만 이벤트 기록)
  let reqRow: PaymentRequestRow | null = null;
  if (ev.provider_ref) {
    const { data } = await db
      .from("payment_requests")
      .select("id, company_id, branch_id, member_id")
      .eq("provider_ref", ev.provider_ref)
      .maybeSingle();
    reqRow = (data as PaymentRequestRow | null) ?? null;
  }

  if (!reqRow) {
    return ok(
      c,
      { received: true, matched: false, event_type: ev.event_type },
      "콜백 수신(매칭 결제요청 없음)"
    );
  }

  // payment_events 멱등 기록 — 중복(provider, event_id)은 무시
  const { error: evErr } = await db.from("payment_events").insert({
    company_id: reqRow.company_id,
    branch_id: reqRow.branch_id,
    payment_request_id: reqRow.id,
    member_id: reqRow.member_id,
    event_type: ev.event_type,
    provider: ev.provider,
    provider_event_id: ev.provider_event_id,
    amount: ev.amount,
    raw_payload: ev.raw,
  });
  if (evErr && !/duplicate|unique/i.test(evErr.message)) {
    return fail(c, "EVENT_WRITE_FAILED", evErr.message, 500);
  }

  // 결제 성공 → 회원권 자동 생성·활성 + 출입권한 부여(멱등)
  if (ev.event_type === "succeeded") {
    const { error: actErr } = await db.rpc("app_activate_paid_membership", {
      _payment_request_id: reqRow.id,
    });
    if (actErr) return fail(c, "ACTIVATE_FAILED", actErr.message, 500);
    return ok(c, { received: true, matched: true, activated: true }, "결제완료 → 회원권 활성");
  }

  // 실패/취소 등 → 상태만 반영
  const status =
    ev.event_type === "failed" ? "failed" : ev.event_type === "cancelled" ? "cancelled" : "pending";
  await db
    .from("payment_requests")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", reqRow.id);

  return ok(c, { received: true, matched: true, event_type: ev.event_type }, "콜백 처리 완료");
});

import { Hono } from "hono";
import type { Env } from "../lib/env";
import { fail, ok } from "../lib/responses";
import { requirePartnerAuth } from "../middleware/partnerAuth";
import { getServiceClient } from "../lib/supabase";
import { generateQrToken } from "../services/qrToken";
import type { SupabaseClient } from "@supabase/supabase-js";

export const externalRoutes = new Hono<{ Bindings: Env }>();

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

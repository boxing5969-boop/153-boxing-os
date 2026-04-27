import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeniedReason } from "@153/shared";

export interface VerifyInput {
  branch_id: string;
  device_id: string;
  credential_type: "face" | "qr" | "card" | "pin" | "admin" | "visitor";
  /** face/card: vendor_user_id, qr: member_id (after token verify), pin: pin code */
  credential_value: string;
  occurred_at: string;
}

export type VerifyDecision =
  | { door_open: true; member_id: string; member_name: string }
  | { door_open: false; member_id: string | null; reason: DeniedReason };

interface DeviceRow {
  id: string;
  branch_id: string;
  status: string;
}

interface MemberRow {
  id: string;
  name: string;
  status: "active" | "trial" | "expired" | "suspended" | "unpaid" | "withdrawn";
}

interface MembershipRow {
  id: string;
  status: string;
  end_date: string;
  payment_status: string;
}

interface TrialPassRow {
  id: string;
  status: string;
  end_at: string;
  max_entries: number;
  used_entries: number;
}

interface GrantRow {
  id: string;
  grant_type: string;
  valid_until: string | null;
  status: string;
}

/**
 * 출입 판단 핵심 로직.
 *  1. device 활성/지점 일치 확인
 *  2. credential 으로 member 식별
 *  3. member.status 검사 (expired/unpaid/suspended/withdrawn 즉시 거절)
 *  4. access_grants 활성 검사 (있으면 통과)
 *  5. memberships 또는 trial_passes 검사 (이행 grant 검사)
 *  6. QR 의 경우 nonce 사용 등록 (호출자가 qrConsumed 전달)
 */
export async function verifyAccess(
  db: SupabaseClient,
  input: VerifyInput,
  qrConsumed: { nonce: string; expires_at: number } | null
): Promise<VerifyDecision> {
  // 1. device
  const { data: device } = await db
    .from("access_devices")
    .select("id,branch_id,status")
    .eq("id", input.device_id)
    .maybeSingle();
  const dev = device as DeviceRow | null;
  if (!dev || dev.branch_id !== input.branch_id || dev.status !== "active") {
    return { door_open: false, member_id: null, reason: "device_error" };
  }

  // 2. member 식별
  let memberId: string | null = null;
  if (input.credential_type === "face" || input.credential_type === "card") {
    const { data: du } = await db
      .from("device_users")
      .select("member_id,status")
      .eq("device_id", input.device_id)
      .eq("vendor_user_id", input.credential_value)
      .maybeSingle();
    const duRow = du as { member_id: string; status: string } | null;
    if (!duRow || duRow.status !== "active") {
      return { door_open: false, member_id: null, reason: "unknown_user" };
    }
    memberId = duRow.member_id;
  } else if (input.credential_type === "qr") {
    memberId = input.credential_value;
  } else {
    return { door_open: false, member_id: null, reason: "unknown_user" };
  }

  // 3. member 상태
  const { data: member } = await db
    .from("members")
    .select("id,name,status")
    .eq("id", memberId)
    .maybeSingle();
  const mem = member as MemberRow | null;
  if (!mem) {
    return { door_open: false, member_id: null, reason: "unknown_user" };
  }

  if (mem.status === "expired") {
    return { door_open: false, member_id: mem.id, reason: "expired_membership" };
  }
  if (mem.status === "unpaid") {
    return { door_open: false, member_id: mem.id, reason: "unpaid" };
  }
  if (mem.status === "suspended") {
    return { door_open: false, member_id: mem.id, reason: "suspended" };
  }
  if (mem.status === "withdrawn") {
    return { door_open: false, member_id: null, reason: "unknown_user" };
  }

  // 4. access_grants
  const nowIso = new Date().toISOString();
  const { data: grants } = await db
    .from("access_grants")
    .select("id,grant_type,valid_until,status")
    .eq("member_id", mem.id)
    .eq("branch_id", input.branch_id)
    .eq("status", "active");

  const hasActiveGrant = ((grants ?? []) as GrantRow[]).some(
    (g) => !g.valid_until || g.valid_until > nowIso
  );

  if (!hasActiveGrant) {
    // 5. memberships
    const today = nowIso.slice(0, 10);
    const { data: ms } = await db
      .from("memberships")
      .select("id,status,end_date,payment_status")
      .eq("member_id", mem.id)
      .eq("status", "active")
      .gte("end_date", today);
    const memberships = (ms ?? []) as MembershipRow[];
    const hasPaidMembership = memberships.some(
      (m) => m.payment_status === "paid" || m.payment_status === "partial"
    );

    if (!hasPaidMembership) {
      // 6. trial_passes
      const { data: tp } = await db
        .from("trial_passes")
        .select("id,status,end_at,max_entries,used_entries")
        .eq("member_id", mem.id)
        .eq("status", "active")
        .gte("end_at", nowIso);
      const trials = (tp ?? []) as TrialPassRow[];
      const useTrial = trials.find((t) => t.used_entries < t.max_entries);

      if (!useTrial) {
        if (trials.length > 0) {
          return { door_open: false, member_id: mem.id, reason: "trial_max_used" };
        }
        return { door_open: false, member_id: mem.id, reason: "no_valid_grant" };
      }
      // trial 사용 횟수 증가 (간단화 — 첫 active 1개)
      await db
        .from("trial_passes")
        .update({ used_entries: useTrial.used_entries + 1 })
        .eq("id", useTrial.id);
    }
  }

  // 7. QR nonce 등록
  if (qrConsumed) {
    await db.from("qr_used_tokens").insert({
      nonce: qrConsumed.nonce,
      member_id: mem.id,
      expires_at: new Date(qrConsumed.expires_at * 1000).toISOString(),
    });
  }

  return { door_open: true, member_id: mem.id, member_name: mem.name };
}

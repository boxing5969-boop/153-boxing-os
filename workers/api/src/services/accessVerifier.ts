import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeniedReason } from "@153/shared";
import { previewAccessForMember } from "./accessPreview";

export interface VerifyInput {
  branch_id: string;
  device_id: string;
  credential_type: "face" | "qr" | "card" | "pin" | "admin" | "visitor";
  /** face/card: vendor_user_id, qr: member_id (after token verify), pin: pin code */
  credential_value: string;
  occurred_at: string;
}

export type VerifyDecision =
  | { door_open: true; member_id: string | null; member_name: string; pin_id?: string; pin_issuer?: string | null }
  | { door_open: false; member_id: string | null; reason: DeniedReason };

interface DeviceRow {
  id: string;
  branch_id: string;
  status: string;
}

interface TrialPassRow {
  id: string;
  status: string;
  end_at: string;
  max_entries: number;
  used_entries: number;
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
  } else if (input.credential_type === "pin") {
    // 비상 PIN — RPC 가 해시 검증 + 사용 카운트 증가
    const { data: pinResult, error: pinErr } = await db.rpc("consume_emergency_pin", {
      _branch_id: input.branch_id,
      _pin: input.credential_value,
    });
    if (pinErr) {
      return { door_open: false, member_id: null, reason: "device_error" };
    }
    const pin = pinResult as
      | { success: true; pin_id: string; issued_by: string | null; purpose: string | null }
      | { success: false; reason: string }
      | null;
    if (!pin || !pin.success) {
      return { door_open: false, member_id: null, reason: "no_valid_grant" };
    }
    return {
      door_open: true,
      member_id: null,
      member_name: "비상 PIN 입장",
      pin_id: pin.pin_id,
      pin_issuer: pin.issued_by,
    };
  } else {
    return { door_open: false, member_id: null, reason: "unknown_user" };
  }

  // 3~5. 권위 판단 (member 상태 / grants / membership / trial) — preview 와 동일 로직 공유
  const decision = await previewAccessForMember(db, memberId, input.branch_id);
  if (!decision.allowed) {
    return { door_open: false, member_id: decision.member_id, reason: decision.reason };
  }

  // 6. trial 로 통과한 경우, 사용 횟수를 증가시켜야 한다 (preview 는 side-effect 없음)
  if (decision.source === "trial") {
    const nowIso = new Date().toISOString();
    const { data: tp } = await db
      .from("trial_passes")
      .select("id,status,end_at,max_entries,used_entries")
      .eq("member_id", decision.member_id)
      .eq("status", "active")
      .gte("end_at", nowIso);
    const trials = (tp ?? []) as TrialPassRow[];
    const useTrial = trials.find((t) => t.used_entries < t.max_entries);
    if (useTrial) {
      await db
        .from("trial_passes")
        .update({ used_entries: useTrial.used_entries + 1 })
        .eq("id", useTrial.id);
    }
  }

  // 7. QR nonce 원자적 소비 — 출입 1회용 보장의 게이트.
  //    nonce 는 qr_used_tokens 의 PRIMARY KEY 이므로, 같은 토큰이 거의 동시에
  //    두 번 들어와도 INSERT 는 하나만 성공하고 나머지는 UNIQUE 위반(23505)으로 실패한다.
  //    INSERT 실패 = 이미 사용된 QR → 출입 거절(fail-closed). 사전 SELECT 검사만으로는
  //    확인~등록 사이 경쟁(TOCTOU)을 막지 못하므로 INSERT 결과를 반드시 게이트로 쓴다.
  if (qrConsumed) {
    const { error: nonceErr } = await db.from("qr_used_tokens").insert({
      nonce: qrConsumed.nonce,
      member_id: decision.member_id,
      expires_at: new Date(qrConsumed.expires_at * 1000).toISOString(),
    });
    if (nonceErr) {
      if (nonceErr.code !== "23505") {
        // UNIQUE 위반이 아닌 다른 DB 오류 — 안전을 위해 거절하고 로그를 남긴다.
        console.error("[verifyAccess] qr_used_tokens insert 실패", nonceErr);
      }
      return { door_open: false, member_id: decision.member_id, reason: "qr_already_used" };
    }
  }

  return { door_open: true, member_id: decision.member_id, member_name: decision.member_name };
}

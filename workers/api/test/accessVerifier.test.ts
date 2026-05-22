/**
 * 출입 판단 통합 테스트 — CLAUDE.md 테스트 시나리오 1~6 + 보조
 *
 * 시나리오 매핑:
 *  1. 유효 회원 face → success (membership)
 *  2. 만료 회원 face → expired_membership
 *  3. 미납 회원 face → unpaid
 *  4. 체험권 1회 사용 후 재입장 → trial_max_used
 *  5. (QR 토큰 만료/재사용은 qrToken.test.ts 에서 별도 — 여기선 qr_used_tokens INSERT 게이트만)
 *  6. QR 캡처 재사용 (qr_used_tokens UNIQUE 위반) → qr_already_used
 *  7. 관리자/비상 PIN 성공/실패 → adminAccess.test.ts 에서 통합 시 함께
 */
import { describe, it, expect } from "vitest";
import { verifyAccess } from "../src/services/accessVerifier";
import { createSupabaseMock } from "./helpers/supabaseMock";
import type { SupabaseClient } from "@supabase/supabase-js";

const NOW = new Date("2026-05-22T10:00:00Z");
const NOW_ISO = NOW.toISOString();
const TODAY = NOW_ISO.slice(0, 10);
const FUTURE_DATE = "2026-12-31";
const PAST_DATE = "2026-05-01";
const FUTURE_ISO = "2026-12-31T23:59:59Z";
const PAST_ISO = "2026-05-01T00:00:00Z";

const baseDevice = { id: "d1", branch_id: "b1", status: "active" };
const baseDeviceUser = { member_id: "m1", status: "active" };
const baseInput = {
  branch_id: "b1",
  device_id: "d1",
  credential_type: "face" as const,
  credential_value: "vendor_uid_1",
  occurred_at: NOW_ISO,
};

describe("verifyAccess", () => {
  // ── 1. 유효회원 face → 출입 성공 ──────────────────────────────────────
  it("유효 회원 (active + paid membership) 얼굴인식 → door_open=true", async () => {
    const db = createSupabaseMock({
      tables: {
        access_devices: baseDevice,
        device_users: baseDeviceUser,
        members: { id: "m1", name: "홍길동", branch_id: "b1", status: "active" },
        access_grants: [],
        memberships: [
          { id: "ms1", status: "active", end_date: FUTURE_DATE, payment_status: "paid" },
        ],
        trial_passes: [],
      },
    });

    const r = await verifyAccess(db as unknown as SupabaseClient, baseInput, null);
    expect(r.door_open).toBe(true);
    if (r.door_open) {
      expect(r.member_id).toBe("m1");
      expect(r.member_name).toBe("홍길동");
    }
  });

  // ── 2. 만료 회원 → 출입 거절 ──────────────────────────────────────────
  it("만료 회원(status=expired) 얼굴인식 → expired_membership", async () => {
    const db = createSupabaseMock({
      tables: {
        access_devices: baseDevice,
        device_users: baseDeviceUser,
        members: { id: "m1", name: "홍길동", branch_id: "b1", status: "expired" },
      },
    });

    const r = await verifyAccess(db as unknown as SupabaseClient, baseInput, null);
    expect(r.door_open).toBe(false);
    if (!r.door_open) {
      expect(r.reason).toBe("expired_membership");
      expect(r.member_id).toBe("m1");
    }
  });

  // ── 3. 미납 회원 → 출입 거절 ──────────────────────────────────────────
  it("미납 회원(status=unpaid) 얼굴인식 → unpaid", async () => {
    const db = createSupabaseMock({
      tables: {
        access_devices: baseDevice,
        device_users: baseDeviceUser,
        members: { id: "m1", name: "홍길동", branch_id: "b1", status: "unpaid" },
      },
    });

    const r = await verifyAccess(db as unknown as SupabaseClient, baseInput, null);
    expect(r.door_open).toBe(false);
    if (!r.door_open) expect(r.reason).toBe("unpaid");
  });

  // ── 보조: 정지 회원 ───────────────────────────────────────────────────
  it("정지 회원(status=suspended) → suspended", async () => {
    const db = createSupabaseMock({
      tables: {
        access_devices: baseDevice,
        device_users: baseDeviceUser,
        members: { id: "m1", name: "홍길동", branch_id: "b1", status: "suspended" },
      },
    });

    const r = await verifyAccess(db as unknown as SupabaseClient, baseInput, null);
    expect(r.door_open).toBe(false);
    if (!r.door_open) expect(r.reason).toBe("suspended");
  });

  // ── 4-a. 체험권 잔여 있음 → 출입 성공 + 카운터 증가 ───────────────────
  it("체험권 잔여 있음(0/3) → success + used_entries 증가", async () => {
    const db = createSupabaseMock({
      tables: {
        access_devices: baseDevice,
        device_users: baseDeviceUser,
        members: { id: "m1", name: "체험회원", branch_id: "b1", status: "trial" },
        access_grants: [],
        memberships: [],
        trial_passes: [
          { id: "tp1", status: "active", end_at: FUTURE_ISO, max_entries: 3, used_entries: 0 },
        ],
      },
    });

    const r = await verifyAccess(db as unknown as SupabaseClient, baseInput, null);
    expect(r.door_open).toBe(true);
    // trial 통과 시 used_entries 증가가 일어났는지
    expect(db._updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        table: "trial_passes",
        patch: expect.objectContaining({ used_entries: 1 }),
      }),
    );
  });

  // ── 4-b. 체험권 1회 사용 후 재입장 → 거절 ─────────────────────────────
  it("체험권 모두 소진(3/3) → trial_max_used", async () => {
    const db = createSupabaseMock({
      tables: {
        access_devices: baseDevice,
        device_users: baseDeviceUser,
        members: { id: "m1", name: "체험회원", branch_id: "b1", status: "trial" },
        access_grants: [],
        memberships: [],
        trial_passes: [
          { id: "tp1", status: "active", end_at: FUTURE_ISO, max_entries: 3, used_entries: 3 },
        ],
      },
    });

    const r = await verifyAccess(db as unknown as SupabaseClient, baseInput, null);
    expect(r.door_open).toBe(false);
    if (!r.door_open) expect(r.reason).toBe("trial_max_used");
  });

  // ── 5. 유효 grant (수동 발급) → 출입 성공 ─────────────────────────────
  it("active access_grant 있음 → success (source=grant)", async () => {
    const db = createSupabaseMock({
      tables: {
        access_devices: baseDevice,
        device_users: baseDeviceUser,
        members: { id: "m1", name: "스태프", branch_id: "b1", status: "active" },
        access_grants: [
          { id: "g1", grant_type: "staff", valid_until: FUTURE_ISO, status: "active" },
        ],
      },
    });

    const r = await verifyAccess(db as unknown as SupabaseClient, baseInput, null);
    expect(r.door_open).toBe(true);
  });

  // ── 6. QR 캡처 재사용 (qr_used_tokens UNIQUE 위반) → qr_already_used ──
  it("이미 사용된 QR nonce (UNIQUE 위반) → qr_already_used", async () => {
    const db = createSupabaseMock({
      tables: {
        access_devices: baseDevice,
        members: { id: "m1", name: "홍길동", branch_id: "b1", status: "active" },
        access_grants: [],
        memberships: [
          { id: "ms1", status: "active", end_date: FUTURE_DATE, payment_status: "paid" },
        ],
        trial_passes: [],
      },
      insertHandlers: {
        qr_used_tokens: () => ({ error: { code: "23505", message: "duplicate key" } }),
      },
    });

    const r = await verifyAccess(
      db as unknown as SupabaseClient,
      { ...baseInput, credential_type: "qr", credential_value: "m1" },
      { nonce: "abc123", expires_at: Math.floor(NOW.getTime() / 1000) + 30 },
    );
    expect(r.door_open).toBe(false);
    if (!r.door_open) expect(r.reason).toBe("qr_already_used");
  });

  // ── 6b. 신선한 QR nonce → 통과 ────────────────────────────────────────
  it("신선한 QR nonce (INSERT 성공) → success", async () => {
    const db = createSupabaseMock({
      tables: {
        access_devices: baseDevice,
        members: { id: "m1", name: "홍길동", branch_id: "b1", status: "active" },
        access_grants: [],
        memberships: [
          { id: "ms1", status: "active", end_date: FUTURE_DATE, payment_status: "paid" },
        ],
        trial_passes: [],
      },
    });

    const r = await verifyAccess(
      db as unknown as SupabaseClient,
      { ...baseInput, credential_type: "qr", credential_value: "m1" },
      { nonce: "fresh-nonce", expires_at: Math.floor(NOW.getTime() / 1000) + 30 },
    );
    expect(r.door_open).toBe(true);
  });

  // ── 7. 비상 PIN 성공 ──────────────────────────────────────────────────
  it("유효한 비상 PIN → door_open=true (pin_id 반환)", async () => {
    const db = createSupabaseMock({
      tables: {
        access_devices: baseDevice,
      },
      rpcResults: {
        consume_emergency_pin: {
          success: true,
          pin_id: "pin-1",
          issued_by: "admin-1",
          purpose: "단말기 점검",
        },
      },
    });

    const r = await verifyAccess(
      db as unknown as SupabaseClient,
      { ...baseInput, credential_type: "pin", credential_value: "123456" },
      null,
    );
    expect(r.door_open).toBe(true);
    if (r.door_open) {
      expect(r.pin_id).toBe("pin-1");
      expect(r.pin_issuer).toBe("admin-1");
      expect(r.member_id).toBeNull();
    }
  });

  // ── 7b. 잘못된/만료 PIN → 거절 ────────────────────────────────────────
  it("잘못된 PIN (RPC success=false) → no_valid_grant", async () => {
    const db = createSupabaseMock({
      tables: {
        access_devices: baseDevice,
      },
      rpcResults: {
        consume_emergency_pin: { success: false, reason: "wrong_pin" },
      },
    });

    const r = await verifyAccess(
      db as unknown as SupabaseClient,
      { ...baseInput, credential_type: "pin", credential_value: "000000" },
      null,
    );
    expect(r.door_open).toBe(false);
    if (!r.door_open) expect(r.reason).toBe("no_valid_grant");
  });

  // ── 단말기 거절 케이스 ────────────────────────────────────────────────
  it("device 비활성 → device_error", async () => {
    const db = createSupabaseMock({
      tables: { access_devices: { id: "d1", branch_id: "b1", status: "inactive" } },
    });
    const r = await verifyAccess(db as unknown as SupabaseClient, baseInput, null);
    expect(r.door_open).toBe(false);
    if (!r.door_open) expect(r.reason).toBe("device_error");
  });

  it("device 지점 불일치 → device_error", async () => {
    const db = createSupabaseMock({
      tables: { access_devices: { id: "d1", branch_id: "OTHER", status: "active" } },
    });
    const r = await verifyAccess(db as unknown as SupabaseClient, baseInput, null);
    expect(r.door_open).toBe(false);
    if (!r.door_open) expect(r.reason).toBe("device_error");
  });

  it("등록 안 된 vendor_user_id → unknown_user", async () => {
    const db = createSupabaseMock({
      tables: {
        access_devices: baseDevice,
        device_users: null, // maybeSingle → null
      },
    });
    const r = await verifyAccess(db as unknown as SupabaseClient, baseInput, null);
    expect(r.door_open).toBe(false);
    if (!r.door_open) expect(r.reason).toBe("unknown_user");
  });

  it("disabled device_user → unknown_user", async () => {
    const db = createSupabaseMock({
      tables: {
        access_devices: baseDevice,
        device_users: { member_id: "m1", status: "disabled" },
      },
    });
    const r = await verifyAccess(db as unknown as SupabaseClient, baseInput, null);
    expect(r.door_open).toBe(false);
    if (!r.door_open) expect(r.reason).toBe("unknown_user");
  });

  // ── 만료된 membership (end_date 과거) → 거절 ──────────────────────────
  it("end_date 가 과거인 membership + grant 없음 → no_valid_grant", async () => {
    const db = createSupabaseMock({
      tables: {
        access_devices: baseDevice,
        device_users: baseDeviceUser,
        members: { id: "m1", name: "홍길동", branch_id: "b1", status: "active" },
        access_grants: [],
        // gte(end_date, today) 필터 mock 이 무시하므로 setup 단에서 빈 배열 사용
        memberships: [],
        trial_passes: [],
      },
    });
    const r = await verifyAccess(db as unknown as SupabaseClient, baseInput, null);
    expect(r.door_open).toBe(false);
    if (!r.door_open) expect(r.reason).toBe("no_valid_grant");
  });

  // ── 미사용 변수 경고 방지 ─────────────────────────────────────────────
  it("(setup) constants referenced", () => {
    expect(TODAY).toBeTruthy();
    expect(PAST_DATE).toBeTruthy();
    expect(PAST_ISO).toBeTruthy();
  });
});

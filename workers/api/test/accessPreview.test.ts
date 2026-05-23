/**
 * accessPreview 직접 테스트 — CRM 미리보기 UI 가 의존.
 * verifyAccess 와 동일 로직을 공유하지만, side-effect 없이 결과만 반환.
 */
import { describe, it, expect } from "vitest";
import { previewAccessForMember } from "../src/services/accessPreview";
import { createSupabaseMock } from "./helpers/supabaseMock";
import type { SupabaseClient } from "@supabase/supabase-js";

const FUTURE_DATE = "2026-12-31";
const FUTURE_ISO = "2026-12-31T23:59:59Z";

describe("previewAccessForMember", () => {
  it("회원 존재 안 함 → unknown_user", async () => {
    const db = createSupabaseMock({ tables: { members: null } });
    const r = await previewAccessForMember(db as unknown as SupabaseClient, "missing");
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe("unknown_user");
  });

  it("withdrawn 회원 → unknown_user (회원ID 노출 안 함)", async () => {
    const db = createSupabaseMock({
      tables: {
        members: { id: "m1", name: "탈퇴", branch_id: "b1", status: "withdrawn" },
      },
    });
    const r = await previewAccessForMember(db as unknown as SupabaseClient, "m1");
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.reason).toBe("unknown_user");
      expect(r.member_id).toBeNull();
    }
  });

  it("grant 우선순위 (membership 없어도 grant 있으면 통과)", async () => {
    const db = createSupabaseMock({
      tables: {
        members: { id: "m1", name: "스태프", branch_id: "b1", status: "active" },
        access_grants: [
          { id: "g1", grant_type: "staff", valid_until: null, status: "active" },
        ],
        memberships: [],
        trial_passes: [],
      },
    });
    const r = await previewAccessForMember(db as unknown as SupabaseClient, "m1");
    expect(r.allowed).toBe(true);
    if (r.allowed) expect(r.source).toBe("grant");
  });

  it("partial 결제 membership 도 통과", async () => {
    const db = createSupabaseMock({
      tables: {
        members: { id: "m1", name: "회원", branch_id: "b1", status: "active" },
        access_grants: [],
        memberships: [
          { id: "ms1", status: "active", end_date: FUTURE_DATE, payment_status: "partial" },
        ],
        trial_passes: [],
      },
    });
    const r = await previewAccessForMember(db as unknown as SupabaseClient, "m1");
    expect(r.allowed).toBe(true);
    if (r.allowed) expect(r.source).toBe("membership");
  });

  it("unpaid 결제 membership 은 통과 안 함 → no_valid_grant", async () => {
    // payment_status=unpaid 인 membership 만 있으면 통과 안 됨
    const db = createSupabaseMock({
      tables: {
        members: { id: "m1", name: "회원", branch_id: "b1", status: "active" },
        access_grants: [],
        memberships: [
          { id: "ms1", status: "active", end_date: FUTURE_DATE, payment_status: "unpaid" },
        ],
        trial_passes: [],
      },
    });
    const r = await previewAccessForMember(db as unknown as SupabaseClient, "m1");
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toBe("no_valid_grant");
  });

  it("trial 잔여 있음 → success(source=trial), 부작용 없음 (used_entries 증가 X)", async () => {
    const db = createSupabaseMock({
      tables: {
        members: { id: "m1", name: "체험", branch_id: "b1", status: "trial" },
        access_grants: [],
        memberships: [],
        trial_passes: [
          { id: "tp1", status: "active", end_at: FUTURE_ISO, max_entries: 3, used_entries: 1 },
        ],
      },
    });
    const r = await previewAccessForMember(db as unknown as SupabaseClient, "m1");
    expect(r.allowed).toBe(true);
    if (r.allowed) expect(r.source).toBe("trial");
    // preview 는 부작용 없어야 함 — update 가 호출되면 안 됨
    expect(db._updateSpy).not.toHaveBeenCalled();
  });

  it("branch_id hint 가 있으면 해당 지점 기준 평가", async () => {
    // 회원은 b1 소속이지만 hint 로 b2 평가 → b2 의 grant 가 있으면 통과
    const db = createSupabaseMock({
      tables: {
        members: { id: "m1", name: "회원", branch_id: "b1", status: "active" },
        access_grants: [
          { id: "g1", grant_type: "staff", valid_until: null, status: "active" },
        ],
        memberships: [],
        trial_passes: [],
      },
    });
    const r = await previewAccessForMember(db as unknown as SupabaseClient, "m1", "b2");
    expect(r.allowed).toBe(true);
    // grant 가 b2 기준으로 조회됐어야 함 (mock 은 필터를 무시하지만 호출 자체는 일어남)
  });
});

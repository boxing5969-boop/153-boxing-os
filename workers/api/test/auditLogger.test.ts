/**
 * auditLogger 통합 테스트.
 * - access_logs 작성 형식 검증 (CLAUDE.md 시나리오 7: 관리자 원격 오픈 로그 저장)
 * - DB 오류 시 graceful 반환 (출입 자체는 막지 않음)
 */
import { describe, it, expect, vi } from "vitest";
import { appendAccessLog } from "../src/services/auditLogger";
import { createSupabaseMock } from "./helpers/supabaseMock";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("appendAccessLog", () => {
  it("success 로그를 정상 기록 → row id 반환", async () => {
    const db = createSupabaseMock({
      insertHandlers: {
        access_logs: () => ({ data: { id: "log-1" }, error: null }),
      },
    });
    const id = await appendAccessLog(db as unknown as SupabaseClient, {
      branch_id: "b1",
      device_id: "d1",
      member_id: "m1",
      credential_type: "face",
      result: "success",
      occurred_at: new Date().toISOString(),
    });
    expect(id).toBe("log-1");
  });

  it("denied 로그 — denied_reason 필수 (시나리오 8: 만료 거절)", async () => {
    const db = createSupabaseMock({
      insertHandlers: {
        access_logs: (row) => {
          // denied_reason 이 entry 에 포함됐는지 확인
          const r = row as { denied_reason?: string };
          if (!r.denied_reason) throw new Error("denied_reason 누락");
          return { data: { id: "log-2" }, error: null };
        },
      },
    });
    const id = await appendAccessLog(db as unknown as SupabaseClient, {
      branch_id: "b1",
      device_id: "d1",
      member_id: "m1",
      credential_type: "face",
      result: "denied",
      denied_reason: "expired_membership",
      occurred_at: new Date().toISOString(),
    });
    expect(id).toBe("log-2");
  });

  it("관리자 원격 오픈 로그 — credential_type=admin, member_id=null 가능", async () => {
    const db = createSupabaseMock({
      insertHandlers: {
        access_logs: (row) => {
          const r = row as { credential_type: string; member_id: string | null };
          expect(r.credential_type).toBe("admin");
          expect(r.member_id).toBeNull();
          return { data: { id: "log-3" }, error: null };
        },
      },
    });
    const id = await appendAccessLog(db as unknown as SupabaseClient, {
      branch_id: "b1",
      device_id: null,
      member_id: null,
      credential_type: "admin",
      result: "success",
      occurred_at: new Date().toISOString(),
    });
    expect(id).toBe("log-3");
  });

  it("DB 오류 발생 시 null 반환 (출입 흐름은 막지 않음)", async () => {
    const db = createSupabaseMock({
      insertHandlers: {
        access_logs: () => ({ data: null, error: { code: "PGRST500", message: "boom" } }),
      },
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = await appendAccessLog(db as unknown as SupabaseClient, {
      branch_id: "b1",
      device_id: "d1",
      member_id: "m1",
      credential_type: "face",
      result: "success",
      occurred_at: new Date().toISOString(),
    });
    expect(id).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

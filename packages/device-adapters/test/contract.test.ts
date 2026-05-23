/**
 * Adapter Contract Test — 모든 단말기 어댑터가 따라야 할 공통 명세.
 *
 * 현재는 MockDeviceAdapter 만 검증. Suprema/ZKTeco/Hikvision 이 실 구현되면
 * 동일 contract 를 거기에도 돌려야 한다 (별도 파일에 같은 케이스 복제).
 *
 * 실 장비 연동 전 보장해야 할 불변식:
 *  1. 멱등성 — 같은 호출 두 번이 첫 번째와 동등한 상태로 수렴
 *  2. 미존재 대상 무효 호출 — throw 하지 않고 no-op 로 처리
 *  3. 삭제 후 재생성 — 가능 (회원 재등록 케이스)
 *  4. logs 보존 — disable/delete 가 과거 logs 를 지우지 않음
 *  5. ping/openDoor 형식 안정성
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  MockDeviceAdapter,
  __mockInjectFaceMatch,
  __mockReset,
  __mockGetUsers,
  __mockGetLogs,
  __mockGetAccessGroups,
} from "../src/adapters/mock";
import type { AdapterContext } from "../src/interface";

const ctx: AdapterContext = {
  device: {
    id: "device-1",
    vendor: "mock",
    device_identifier: "MOCK-001",
    api_endpoint: "https://mock.local",
  },
  device_api_key: "test-key",
  base_url: "https://mock.local",
};

describe("Adapter contract — 멱등성", () => {
  beforeEach(() => __mockReset());

  it("같은 user 를 disableUser 두 번 호출해도 동일한 결과 (no throw)", async () => {
    const adapter = new MockDeviceAdapter();
    await adapter.createUser(ctx, { id: "m1", name: "A" });
    await adapter.disableUser(ctx, "mock_m1");
    await expect(adapter.disableUser(ctx, "mock_m1")).resolves.not.toThrow();
    expect(__mockGetUsers("device-1")).toHaveLength(0);
  });

  it("같은 user 를 deleteUser 두 번 호출해도 동일", async () => {
    const adapter = new MockDeviceAdapter();
    await adapter.createUser(ctx, { id: "m1", name: "A" });
    await adapter.deleteUser(ctx, "mock_m1");
    await expect(adapter.deleteUser(ctx, "mock_m1")).resolves.not.toThrow();
  });

  it("같은 access group 두 번 assign 해도 1개만", async () => {
    const adapter = new MockDeviceAdapter();
    await adapter.createUser(ctx, { id: "m1", name: "A" });
    await adapter.assignAccessGroup(ctx, "mock_m1", { group_id: "g1", name: "X" });
    await adapter.assignAccessGroup(ctx, "mock_m1", { group_id: "g1", name: "X" });
    expect(__mockGetAccessGroups("device-1", "mock_m1")).toEqual(["g1"]);
  });
});

describe("Adapter contract — 미존재 대상 처리", () => {
  beforeEach(() => __mockReset());

  it("등록 안 된 user 를 disableUser → no-op", async () => {
    const adapter = new MockDeviceAdapter();
    await expect(
      adapter.disableUser(ctx, "never_existed"),
    ).resolves.not.toThrow();
  });

  it("등록 안 된 user 를 deleteUser → no-op", async () => {
    const adapter = new MockDeviceAdapter();
    await expect(
      adapter.deleteUser(ctx, "never_existed"),
    ).resolves.not.toThrow();
  });

  it("등록 안 된 group 을 removeAccessGroup → no-op", async () => {
    const adapter = new MockDeviceAdapter();
    await adapter.createUser(ctx, { id: "m1", name: "A" });
    await expect(
      adapter.removeAccessGroup(ctx, "mock_m1", "never_assigned"),
    ).resolves.not.toThrow();
  });

  it("updateUser on non-existent vuid → no-op (회원 정보 변경 손실 방지)", async () => {
    const adapter = new MockDeviceAdapter();
    await expect(
      adapter.updateUser(ctx, { id: "m1", name: "B" }, "never_existed"),
    ).resolves.not.toThrow();
  });
});

describe("Adapter contract — 삭제 후 재생성", () => {
  beforeEach(() => __mockReset());

  it("회원 재등록 시 같은 member id 로 새 vendor_user_id 발급 OK", async () => {
    const adapter = new MockDeviceAdapter();
    const vuid1 = await adapter.createUser(ctx, { id: "m1", name: "A" });
    await adapter.deleteUser(ctx, vuid1);
    expect(__mockGetUsers("device-1")).toHaveLength(0);

    // 같은 member id 로 다시 등록 가능
    const vuid2 = await adapter.createUser(ctx, { id: "m1", name: "A" });
    expect(vuid2).toBe(vuid1); // mock 은 deterministic — 실 vendor 는 다를 수도
    expect(__mockGetUsers("device-1")).toHaveLength(1);
  });
});

describe("Adapter contract — logs 보존", () => {
  beforeEach(() => __mockReset());

  it("disableUser 후에도 과거 face_match 로그는 보존 (감사 추적)", async () => {
    const adapter = new MockDeviceAdapter();
    await adapter.createUser(ctx, { id: "m1", name: "A" });
    __mockInjectFaceMatch("device-1", "mock_m1");
    await adapter.disableUser(ctx, "mock_m1");

    // logs 가 지워지면 안 됨 — 출입 거절 사유 분석을 위해 보존
    expect(__mockGetLogs("device-1")).toHaveLength(1);
    // 어댑터 통해서도 조회 가능해야 함
    const logs = await adapter.pullAccessLogs(ctx, new Date(0));
    expect(logs).toHaveLength(1);
  });
});

describe("Adapter contract — 응답 형식 안정성", () => {
  beforeEach(() => __mockReset());

  it("openDoor 응답은 항상 ISO8601 UTC 문자열", async () => {
    const adapter = new MockDeviceAdapter();
    const r = await adapter.openDoor(ctx);
    expect(r.opened_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("ping 응답에 ok: boolean 필수, firmware 는 string optional", async () => {
    const adapter = new MockDeviceAdapter();
    const r = await adapter.ping(ctx);
    expect(typeof r.ok).toBe("boolean");
    if (r.firmware !== undefined) {
      expect(typeof r.firmware).toBe("string");
    }
  });

  it("createUser 반환 vendor_user_id 는 non-empty string", async () => {
    const adapter = new MockDeviceAdapter();
    const vuid = await adapter.createUser(ctx, { id: "m1", name: "A" });
    expect(typeof vuid).toBe("string");
    expect(vuid.length).toBeGreaterThan(0);
  });

  it("pullAccessLogs 결과 항목은 vendor_event_id 가 고유", async () => {
    const adapter = new MockDeviceAdapter();
    __mockInjectFaceMatch("device-1", "vu1");
    __mockInjectFaceMatch("device-1", "vu1"); // 같은 vuid, 시간만 다른 두 로그
    const logs = await adapter.pullAccessLogs(ctx, new Date(0));
    const ids = logs.map((l) => l.vendor_event_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("Adapter contract — 지점 격리", () => {
  beforeEach(() => __mockReset());

  it("다른 device 의 user 는 서로 격리됨", async () => {
    const adapter = new MockDeviceAdapter();
    const ctx2: AdapterContext = {
      ...ctx,
      device: { ...ctx.device, id: "device-2" },
    };
    await adapter.createUser(ctx, { id: "m1", name: "A" });
    expect(__mockGetUsers("device-1")).toHaveLength(1);
    expect(__mockGetUsers("device-2")).toHaveLength(0);

    await adapter.disableUser(ctx2, "mock_m1");
    // device-2 에서 disable 해도 device-1 의 user 는 그대로
    expect(__mockGetUsers("device-1")).toHaveLength(1);
  });
});

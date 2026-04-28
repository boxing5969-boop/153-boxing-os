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

describe("MockDeviceAdapter", () => {
  beforeEach(() => __mockReset());

  it("createUser returns vendor_user_id and stores user", async () => {
    const adapter = new MockDeviceAdapter();
    const vuid = await adapter.createUser(ctx, { id: "m1", name: "Alice" });
    expect(vuid).toBe("mock_m1");

    const users = __mockGetUsers("device-1");
    expect(users).toHaveLength(1);
    expect(users[0]?.member_id).toBe("m1");
    expect(users[0]?.face_registered).toBe(true);
  });

  it("createUser is idempotent for same member id", async () => {
    const adapter = new MockDeviceAdapter();
    await adapter.createUser(ctx, { id: "m1", name: "Alice" });
    await adapter.createUser(ctx, { id: "m1", name: "Alice 2" });
    expect(__mockGetUsers("device-1")).toHaveLength(1);
  });

  it("disableUser removes user from device", async () => {
    const adapter = new MockDeviceAdapter();
    await adapter.createUser(ctx, { id: "m1", name: "Alice" });
    await adapter.disableUser(ctx, "mock_m1");
    expect(__mockGetUsers("device-1")).toHaveLength(0);
  });

  it("deleteUser removes user and access groups", async () => {
    const adapter = new MockDeviceAdapter();
    await adapter.createUser(ctx, { id: "m1", name: "Alice" });
    await adapter.assignAccessGroup(ctx, "mock_m1", { group_id: "g1", name: "Default" });
    expect(__mockGetAccessGroups("device-1", "mock_m1")).toEqual(["g1"]);

    await adapter.deleteUser(ctx, "mock_m1");
    expect(__mockGetUsers("device-1")).toHaveLength(0);
    expect(__mockGetAccessGroups("device-1", "mock_m1")).toEqual([]);
  });

  it("assignAccessGroup + removeAccessGroup", async () => {
    const adapter = new MockDeviceAdapter();
    await adapter.createUser(ctx, { id: "m1", name: "Alice" });
    await adapter.assignAccessGroup(ctx, "mock_m1", { group_id: "g1", name: "A" });
    await adapter.assignAccessGroup(ctx, "mock_m1", { group_id: "g2", name: "B" });
    expect(__mockGetAccessGroups("device-1", "mock_m1").sort()).toEqual(["g1", "g2"]);
    await adapter.removeAccessGroup(ctx, "mock_m1", "g1");
    expect(__mockGetAccessGroups("device-1", "mock_m1")).toEqual(["g2"]);
  });

  it("__mockInjectFaceMatch creates retrievable log", async () => {
    const adapter = new MockDeviceAdapter();
    __mockInjectFaceMatch("device-1", "mock_m1");
    const logs = await adapter.pullAccessLogs(ctx, new Date(0));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.event_type).toBe("face_match");
    expect(logs[0]?.vendor_user_id).toBe("mock_m1");
  });

  it("pullAccessLogs filters by since", async () => {
    const adapter = new MockDeviceAdapter();
    __mockInjectFaceMatch("device-1", "mock_m1");
    const future = new Date(Date.now() + 60_000);
    const logs = await adapter.pullAccessLogs(ctx, future);
    expect(logs).toHaveLength(0);
  });

  it("openDoor returns timestamp string", async () => {
    const adapter = new MockDeviceAdapter();
    const result = await adapter.openDoor(ctx);
    expect(result.opened_at).toBeDefined();
    const parsed = new Date(result.opened_at);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
  });

  it("ping returns ok + firmware", async () => {
    const adapter = new MockDeviceAdapter();
    const r = await adapter.ping(ctx);
    expect(r.ok).toBe(true);
    expect(r.firmware).toBe("mock-1.0");
  });

  it("__mockReset clears all state", async () => {
    const adapter = new MockDeviceAdapter();
    await adapter.createUser(ctx, { id: "m1", name: "Alice" });
    __mockInjectFaceMatch("device-1", "mock_m1");
    __mockReset();
    expect(__mockGetUsers("device-1")).toHaveLength(0);
    expect(__mockGetLogs("device-1")).toHaveLength(0);
  });
});

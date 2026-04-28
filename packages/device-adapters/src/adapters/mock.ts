import type {
  AccessDeviceAdapter,
  AccessDeviceMember,
  AccessGroup,
  AdapterContext,
  DeviceUser,
  VendorAccessLog,
} from "../interface";

/**
 * Phase 7 — MockDeviceAdapter with in-memory state.
 * 모듈 레벨 store 라 테스트 간 격리는 __mockReset() 호출 필수.
 */

interface MockUser extends DeviceUser {
  member_id: string;
}

const userStore = new Map<string, Map<string, MockUser>>(); // device_id → vuid → user
const logStore = new Map<string, VendorAccessLog[]>(); // device_id → logs
const accessGroups = new Map<string, Set<string>>(); // `${device_id}:${vuid}` → group_ids

function bucket<K, V>(map: Map<K, V>, key: K, factory: () => V): V {
  let v = map.get(key);
  if (!v) {
    v = factory();
    map.set(key, v);
  }
  return v;
}

export class MockDeviceAdapter implements AccessDeviceAdapter {
  async createUser(ctx: AdapterContext, member: AccessDeviceMember): Promise<string> {
    const users = bucket(userStore, ctx.device.id, () => new Map<string, MockUser>());
    const vendor_user_id = `mock_${member.id}`;
    users.set(vendor_user_id, {
      vendor_user_id,
      member_id: member.id,
      face_registered: true,
      qr_enabled: true,
      card_enabled: false,
    });
    return vendor_user_id;
  }

  async updateUser(
    ctx: AdapterContext,
    member: AccessDeviceMember,
    vendor_user_id: string
  ): Promise<void> {
    const users = userStore.get(ctx.device.id);
    const existing = users?.get(vendor_user_id);
    if (existing) {
      existing.member_id = member.id;
    }
  }

  async disableUser(ctx: AdapterContext, vendor_user_id: string): Promise<void> {
    userStore.get(ctx.device.id)?.delete(vendor_user_id);
  }

  async deleteUser(ctx: AdapterContext, vendor_user_id: string): Promise<void> {
    userStore.get(ctx.device.id)?.delete(vendor_user_id);
    accessGroups.delete(`${ctx.device.id}:${vendor_user_id}`);
  }

  async assignAccessGroup(
    ctx: AdapterContext,
    vendor_user_id: string,
    group: AccessGroup
  ): Promise<void> {
    const key = `${ctx.device.id}:${vendor_user_id}`;
    bucket(accessGroups, key, () => new Set<string>()).add(group.group_id);
  }

  async removeAccessGroup(
    ctx: AdapterContext,
    vendor_user_id: string,
    group_id: string
  ): Promise<void> {
    const key = `${ctx.device.id}:${vendor_user_id}`;
    accessGroups.get(key)?.delete(group_id);
  }

  async pullAccessLogs(ctx: AdapterContext, since: Date): Promise<VendorAccessLog[]> {
    const list = logStore.get(ctx.device.id) ?? [];
    return list.filter((l) => new Date(l.occurred_at) >= since);
  }

  async openDoor(_ctx: AdapterContext): Promise<{ opened_at: string }> {
    return { opened_at: new Date().toISOString() };
  }

  async ping(_ctx: AdapterContext): Promise<{ ok: boolean; firmware?: string }> {
    return { ok: true, firmware: "mock-1.0" };
  }
}

// ============================================================
// Test helpers — production code 가 사용 금지, vitest 전용
// ============================================================

function generateEventId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function __mockInjectFaceMatch(
  deviceId: string,
  vendor_user_id: string
): VendorAccessLog {
  const entry: VendorAccessLog = {
    vendor_event_id: generateEventId(),
    vendor_user_id,
    event_type: "face_match",
    occurred_at: new Date().toISOString(),
    raw: {},
  };
  bucket(logStore, deviceId, () => [] as VendorAccessLog[]).push(entry);
  return entry;
}

export function __mockReset(): void {
  userStore.clear();
  logStore.clear();
  accessGroups.clear();
}

export function __mockGetUsers(deviceId: string): MockUser[] {
  return Array.from(userStore.get(deviceId)?.values() ?? []);
}

export function __mockGetLogs(deviceId: string): VendorAccessLog[] {
  return [...(logStore.get(deviceId) ?? [])];
}

export function __mockGetAccessGroups(
  deviceId: string,
  vendor_user_id: string
): string[] {
  return Array.from(accessGroups.get(`${deviceId}:${vendor_user_id}`) ?? []);
}

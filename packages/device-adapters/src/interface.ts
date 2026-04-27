export interface DeviceUser {
  vendor_user_id: string;
  face_registered: boolean;
  qr_enabled: boolean;
  card_enabled: boolean;
}

export interface AccessGroup {
  group_id: string;
  name: string;
}

export interface VendorAccessLog {
  vendor_event_id: string;
  vendor_user_id: string;
  event_type: "face_match" | "card_swipe" | "door_open" | "denied";
  occurred_at: string;
  raw: Record<string, unknown>;
}

export interface AccessDeviceMember {
  id: string;
  name: string;
  phone?: string;
}

export interface AccessDevice {
  id: string;
  vendor: string;
  device_identifier: string | null;
  api_endpoint: string | null;
}

export interface AdapterContext {
  device: AccessDevice;
  device_api_key: string;
  base_url: string;
  request_id?: string;
}

/**
 * 단말기 어댑터 통합 인터페이스.
 * 모든 메서드는 throw 시 sync_job=failed 로 기록되며, 반환값은 idempotent 해야 한다.
 */
export interface AccessDeviceAdapter {
  createUser(ctx: AdapterContext, member: AccessDeviceMember): Promise<string>;
  updateUser(
    ctx: AdapterContext,
    member: AccessDeviceMember,
    vendor_user_id: string
  ): Promise<void>;
  disableUser(ctx: AdapterContext, vendor_user_id: string): Promise<void>;
  deleteUser(ctx: AdapterContext, vendor_user_id: string): Promise<void>;
  assignAccessGroup(
    ctx: AdapterContext,
    vendor_user_id: string,
    group: AccessGroup
  ): Promise<void>;
  removeAccessGroup(
    ctx: AdapterContext,
    vendor_user_id: string,
    group_id: string
  ): Promise<void>;
  pullAccessLogs(ctx: AdapterContext, since: Date): Promise<VendorAccessLog[]>;
  openDoor(ctx: AdapterContext): Promise<{ opened_at: string }>;
  ping(ctx: AdapterContext): Promise<{ ok: boolean; firmware?: string }>;
}

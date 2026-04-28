import type {
  AccessDeviceAdapter,
  AccessDeviceMember,
  AccessGroup,
  AdapterContext,
  VendorAccessLog,
} from "../interface";

/**
 * MockDeviceAdapter — Phase 6 구현.
 * 모든 메서드가 성공 응답을 반환 (no-op + 일관된 vendor_user_id 발급).
 * Phase 7 에서 내부 상태 트래킹 + __injectFaceMatch 등 시뮬 helper 추가 예정.
 */
export class MockDeviceAdapter implements AccessDeviceAdapter {
  async createUser(_ctx: AdapterContext, member: AccessDeviceMember): Promise<string> {
    return `mock_${member.id}`;
  }
  async updateUser(
    _ctx: AdapterContext,
    _member: AccessDeviceMember,
    _vendor_user_id: string
  ): Promise<void> {
    // no-op
  }
  async disableUser(_ctx: AdapterContext, _vendor_user_id: string): Promise<void> {
    // no-op
  }
  async deleteUser(_ctx: AdapterContext, _vendor_user_id: string): Promise<void> {
    // no-op
  }
  async assignAccessGroup(
    _ctx: AdapterContext,
    _vendor_user_id: string,
    _group: AccessGroup
  ): Promise<void> {
    // no-op
  }
  async removeAccessGroup(
    _ctx: AdapterContext,
    _vendor_user_id: string,
    _group_id: string
  ): Promise<void> {
    // no-op
  }
  async pullAccessLogs(_ctx: AdapterContext, _since: Date): Promise<VendorAccessLog[]> {
    return [];
  }
  async openDoor(_ctx: AdapterContext): Promise<{ opened_at: string }> {
    return { opened_at: new Date().toISOString() };
  }
  async ping(_ctx: AdapterContext): Promise<{ ok: boolean; firmware?: string }> {
    return { ok: true, firmware: "mock-1.0" };
  }
}

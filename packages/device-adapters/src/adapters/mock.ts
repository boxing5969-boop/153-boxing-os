import type {
  AccessDeviceAdapter,
  AccessDeviceMember,
  AccessGroup,
  AdapterContext,
  VendorAccessLog,
} from "../interface";

const VENDOR = "MockDeviceAdapter";
const niy = (method: string): never => {
  throw new Error(`${VENDOR}.${method} not implemented yet (Phase 7)`);
};

export class MockDeviceAdapter implements AccessDeviceAdapter {
  async createUser(_ctx: AdapterContext, _member: AccessDeviceMember): Promise<string> {
    return niy("createUser");
  }
  async updateUser(
    _ctx: AdapterContext,
    _member: AccessDeviceMember,
    _vendor_user_id: string
  ): Promise<void> {
    niy("updateUser");
  }
  async disableUser(_ctx: AdapterContext, _vendor_user_id: string): Promise<void> {
    niy("disableUser");
  }
  async deleteUser(_ctx: AdapterContext, _vendor_user_id: string): Promise<void> {
    niy("deleteUser");
  }
  async assignAccessGroup(
    _ctx: AdapterContext,
    _vendor_user_id: string,
    _group: AccessGroup
  ): Promise<void> {
    niy("assignAccessGroup");
  }
  async removeAccessGroup(
    _ctx: AdapterContext,
    _vendor_user_id: string,
    _group_id: string
  ): Promise<void> {
    niy("removeAccessGroup");
  }
  async pullAccessLogs(_ctx: AdapterContext, _since: Date): Promise<VendorAccessLog[]> {
    return niy("pullAccessLogs");
  }
  async openDoor(_ctx: AdapterContext): Promise<{ opened_at: string }> {
    return niy("openDoor");
  }
  async ping(_ctx: AdapterContext): Promise<{ ok: boolean; firmware?: string }> {
    return niy("ping");
  }
}

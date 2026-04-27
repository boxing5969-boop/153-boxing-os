import type { AccessDeviceAdapter } from "./interface";
import { MockDeviceAdapter } from "./adapters/mock";
import { SupremaAdapter } from "./adapters/suprema";
import { ZktecoAdapter } from "./adapters/zkteco";
import { HikvisionAdapter } from "./adapters/hikvision";

export function getAdapter(vendor: string): AccessDeviceAdapter {
  switch (vendor) {
    case "mock":
      return new MockDeviceAdapter();
    case "suprema":
      return new SupremaAdapter();
    case "zkteco":
      return new ZktecoAdapter();
    case "hikvision":
      return new HikvisionAdapter();
    default:
      throw new Error(`Unsupported vendor: ${vendor}`);
  }
}

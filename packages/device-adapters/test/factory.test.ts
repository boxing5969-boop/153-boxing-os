/**
 * Adapter factory test — vendor 매핑 회귀 방지.
 * 새 vendor 가 추가될 때 누락 안 되게.
 */
import { describe, it, expect } from "vitest";
import { getAdapter } from "../src/factory";
import { MockDeviceAdapter } from "../src/adapters/mock";
import { SupremaAdapter } from "../src/adapters/suprema";
import { ZktecoAdapter } from "../src/adapters/zkteco";
import { HikvisionAdapter } from "../src/adapters/hikvision";

describe("getAdapter", () => {
  it("mock → MockDeviceAdapter", () => {
    expect(getAdapter("mock")).toBeInstanceOf(MockDeviceAdapter);
  });

  it("suprema → SupremaAdapter", () => {
    expect(getAdapter("suprema")).toBeInstanceOf(SupremaAdapter);
  });

  it("zkteco → ZktecoAdapter", () => {
    expect(getAdapter("zkteco")).toBeInstanceOf(ZktecoAdapter);
  });

  it("hikvision → HikvisionAdapter", () => {
    expect(getAdapter("hikvision")).toBeInstanceOf(HikvisionAdapter);
  });

  it("미지원 vendor → throw", () => {
    expect(() => getAdapter("unknown_vendor")).toThrow(/Unsupported vendor/);
    expect(() => getAdapter("")).toThrow();
  });

  it("매번 새 인스턴스 반환 (factory 캐시 없음)", () => {
    const a1 = getAdapter("mock");
    const a2 = getAdapter("mock");
    expect(a1).not.toBe(a2);
  });
});

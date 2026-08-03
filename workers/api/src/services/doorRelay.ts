/**
 * FC-4: 문 제어(릴레이) 어댑터 — 크라이저 회신 전 스켈레톤.
 * 원칙(153os): 벤더 호출을 비즈니스 로직에 직접 박지 않는다 — 어댑터만 교체하면 되게.
 * DOOR_RELAY_PROVIDER 미설정(기본) = no-op(아무 것도 안 함), 'mock' = 로그만,
 * 'kreiser' = 크라이저 오픈 API 명세 수령 후 openDoor 내부만 구현.
 * 문 열기 실패는 절대 출입 판정(verify 응답)에 영향을 주지 않는다.
 */
import type { Env } from "../lib/env";

export interface DoorRelayAdapter {
  openDoor(branchId: string): Promise<{ ok: boolean; detail?: string }>;
}

class NoopRelayAdapter implements DoorRelayAdapter {
  async openDoor(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true, detail: "relay 미구성(no-op)" };
  }
}

class MockRelayAdapter implements DoorRelayAdapter {
  async openDoor(branchId: string): Promise<{ ok: boolean; detail?: string }> {
    console.log("[doorRelay:mock] openDoor", branchId);
    return { ok: true, detail: "mock" };
  }
}

// 크라이저 어댑터 — 명세 수령 후 이 안만 채운다 (URL·키는 wrangler secret)
class KreiserRelayAdapter implements DoorRelayAdapter {
  constructor(private readonly env: Env) {}
  async openDoor(branchId: string): Promise<{ ok: boolean; detail?: string }> {
    if (!this.env.DOOR_RELAY_API_URL || !this.env.DOOR_RELAY_API_KEY) {
      return { ok: false, detail: "크라이저 API 미설정" };
    }
    // TODO(FC-4): 크라이저 오픈 API 명세 수령 후 실제 호출 구현
    console.log("[doorRelay:kreiser] openDoor(미구현)", branchId);
    return { ok: false, detail: "크라이저 연동 미구현" };
  }
}

export function getDoorRelay(env: Env): DoorRelayAdapter {
  switch (env.DOOR_RELAY_PROVIDER) {
    case "mock":
      return new MockRelayAdapter();
    case "kreiser":
      return new KreiserRelayAdapter(env);
    default:
      return new NoopRelayAdapter();
  }
}

/** verify 통과 시 호출 — 설정 없으면 즉시 no-op. 오류는 삼키고 로그만 남긴다. */
export async function openDoorSafe(env: Env, branchId: string): Promise<void> {
  try {
    const r = await getDoorRelay(env).openDoor(branchId);
    if (!r.ok) console.warn("[doorRelay] open 실패:", r.detail);
  } catch (e) {
    console.error("[doorRelay] 오류", e);
  }
}

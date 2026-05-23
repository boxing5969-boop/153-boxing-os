/**
 * processWithLimit 동시성 제한 검증.
 */
import { describe, it, expect } from "vitest";
import { processWithLimit } from "../src/lib/concurrency";

describe("processWithLimit", () => {
  it("결과는 입력 순서를 보존", async () => {
    const items = [10, 20, 30, 40, 50];
    const out = await processWithLimit(items, 3, async (x) => x * 2);
    expect(out).toEqual([20, 40, 60, 80, 100]);
  });

  it("빈 배열은 빈 결과", async () => {
    const out = await processWithLimit([], 5, async () => 1);
    expect(out).toEqual([]);
  });

  it("limit=1 이면 순차 실행 (실제 시작 순서 == 입력 순서)", async () => {
    const order: number[] = [];
    await processWithLimit([1, 2, 3, 4], 1, async (x) => {
      order.push(x);
      await new Promise((r) => setTimeout(r, 5));
      return x;
    });
    expect(order).toEqual([1, 2, 3, 4]);
  });

  it("동시 실행 수가 limit 을 초과하지 않음", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 30 }, (_, i) => i);
    await processWithLimit(items, 5, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight -= 1;
      return 0;
    });
    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(maxInFlight).toBeGreaterThanOrEqual(2); // 실제로 병렬로 돌긴 했는지
  });

  it("limit > items.length 이면 모든 item 한 번에 시작", async () => {
    let started = 0;
    let maxStarted = 0;
    await processWithLimit([1, 2, 3], 10, async (x) => {
      started += 1;
      maxStarted = Math.max(maxStarted, started);
      await new Promise((r) => setTimeout(r, 5));
      started -= 1;
      return x;
    });
    expect(maxStarted).toBe(3); // items.length 만큼만
  });

  it("개별 실패 catch — 콜백 안에서 처리 시 전체 작업 계속", async () => {
    const results = await processWithLimit([1, 2, 3, 4], 2, async (x) => {
      try {
        if (x === 2) throw new Error("boom");
        return { ok: true, x };
      } catch (e) {
        return { ok: false, x, error: (e as Error).message };
      }
    });
    expect(results).toHaveLength(4);
    expect(results[1]).toEqual({ ok: false, x: 2, error: "boom" });
    expect(results[2]).toEqual({ ok: true, x: 3 });
  });
});

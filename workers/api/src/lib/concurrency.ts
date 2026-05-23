/**
 * 비동기 작업 동시성 제한 헬퍼.
 *
 * 사용 케이스:
 *  - 알리고 SMS/알림톡 발송 (rate limit ~500/분 = 약 8/초)
 *  - 단말기 동기화 (API 부하 분산)
 *
 * 알리고 발송에서 권장값: NOTIFY_CONCURRENCY=6 (안전 마진 포함).
 *
 * 동작:
 *  - items 배열을 limit 만큼의 worker 가 동시 소비
 *  - 각 worker 가 item.fn() 을 await, 다음 index 로 진행
 *  - 결과는 입력 순서대로 R[] 로 반환 (실패 케이스도 callback 안에서 처리)
 *
 * 시간 복잡도: O(items.length / limit) — 가장 느린 path 기준.
 */

export const NOTIFY_CONCURRENCY = 6;

export async function processWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

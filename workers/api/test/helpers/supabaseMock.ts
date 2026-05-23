/**
 * 테스트용 Supabase 클라이언트 mock.
 *
 * 사용법:
 *   const db = createSupabaseMock({
 *     tables: {
 *       access_devices: [{ id: "d1", branch_id: "b1", status: "active" }],
 *       members: [{ id: "m1", name: "홍길동", branch_id: "b1", status: "active" }],
 *     },
 *     rpcResults: {
 *       consume_emergency_pin: { success: true, pin_id: "p1", issued_by: "u1", purpose: null },
 *     },
 *     insertHandlers: {
 *       qr_used_tokens: (row, called) => called > 1 ? { error: { code: "23505" } } : { error: null },
 *     },
 *   });
 *
 * 체이닝 메서드(select/eq/gte/lt/in/is/not/order/limit 등)는 모두 self-return.
 * 종료 메서드:
 *   - maybeSingle() / single() → 단일 row (배열이면 첫 원소, 없으면 null)
 *   - 직접 await → 전체 배열
 *   - insert(row) → insertHandlers[table] 결과 또는 { data: row, error: null }
 *   - update(patch) → updateHandlers[table] 또는 self (await 시 { error: null })
 *   - delete() → self (await 시 { error: null })
 */
import { vi } from "vitest";

export interface SupabaseMockSetup {
  tables?: Record<string, unknown | unknown[] | null>;
  rpcResults?: Record<string, unknown>;
  /** 같은 table 에 insert 호출이 여러 번 일어날 때마다 콜백이 호출됨 (callCount 1부터) */
  insertHandlers?: Record<string, (row: unknown, callCount: number) => { data?: unknown; error: unknown }>;
  updateHandlers?: Record<string, (patch: unknown) => { error: unknown }>;
}

interface ChainResult {
  data: unknown;
  error: unknown;
}

export function createSupabaseMock(setup: SupabaseMockSetup) {
  const tables = setup.tables ?? {};
  const insertCounts: Record<string, number> = {};
  const updateSpy = vi.fn();

  function buildChain(table: string): unknown {
    const raw = tables[table];
    const asArray = Array.isArray(raw) ? raw : raw == null ? [] : [raw];

    const result: ChainResult = { data: asArray, error: null };

    const chain: Record<string, unknown> = {};

    // 체이닝 메서드 — 전부 self return (필터 무시: mock 입력은 setup 단에서 이미 결정됨)
    const passthrough = [
      "select", "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike",
      "is", "in", "contains", "containedBy", "filter", "match", "or", "and",
      "not", "order", "limit", "range", "single", "csv",
    ];
    for (const m of passthrough) {
      chain[m] = () => chain;
    }

    chain.maybeSingle = () =>
      Promise.resolve({ data: asArray[0] ?? null, error: null });
    chain.single = () =>
      Promise.resolve(
        asArray[0]
          ? { data: asArray[0], error: null }
          : { data: null, error: { code: "PGRST116", message: "no rows" } },
      );

    chain.insert = (row: unknown) => {
      const count = (insertCounts[table] = (insertCounts[table] ?? 0) + 1);
      const handler = setup.insertHandlers?.[table];
      const settled = handler ? handler(row, count) : { data: row, error: null };

      // insert(row).select("id").single() 같은 체이닝 지원
      const insChain: Record<string, unknown> = {};
      for (const m of passthrough) insChain[m] = () => insChain;
      insChain.maybeSingle = () => Promise.resolve(settled);
      insChain.single = () => Promise.resolve(settled);
      // 직접 await(insert()) — chained 없이도 호출 가능
      insChain.then = (resolve: (v: unknown) => void) => resolve(settled);
      return insChain;
    };

    chain.update = (patch: unknown) => {
      updateSpy({ table, patch });
      const handler = setup.updateHandlers?.[table];
      const ret = handler ? handler(patch) : { error: null };
      // update().eq(...) 패턴도 await 가능해야 함
      const updateChain: Record<string, unknown> = {};
      for (const m of passthrough) updateChain[m] = () => updateChain;
      updateChain.then = (resolve: (v: unknown) => void) => resolve(ret);
      return updateChain;
    };

    chain.delete = () => {
      const delChain: Record<string, unknown> = {};
      for (const m of passthrough) delChain[m] = () => delChain;
      delChain.then = (resolve: (v: unknown) => void) =>
        resolve({ error: null });
      return delChain;
    };

    // 직접 await 지원 — 전체 배열 반환
    chain.then = (resolve: (v: unknown) => void) => resolve(result);

    return chain;
  }

  const db = {
    from: (table: string) => buildChain(table),
    rpc: (fn: string, _args?: unknown) =>
      Promise.resolve({
        data: setup.rpcResults?.[fn] ?? null,
        error: null,
      }),
  };

  return Object.assign(db, {
    /** 테스트 끝나고 update 호출 검증용 */
    _updateSpy: updateSpy,
    _insertCounts: insertCounts,
  });
}

export type SupabaseMock = ReturnType<typeof createSupabaseMock>;

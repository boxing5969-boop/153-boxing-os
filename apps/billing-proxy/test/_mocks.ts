/**
 * Vitest 공용 mock 헬퍼.
 * - makeMockSupabase: rpc + from() 체이닝 흉내
 * - resetMockEnv: 테스트마다 환경변수 / 캐시 초기화
 */
import { vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resetConfigCache } from "../src/config";
import { setSupabaseForTest } from "../src/lib/supabase";

export interface MockResponse {
  data?: unknown;
  error?: { message: string } | null;
}

type RpcHandler = (args: Record<string, unknown>) => MockResponse | Promise<MockResponse>;
type TableOpHandler = (args: { tableName: string; op: string; filters: Record<string, unknown>; payload?: unknown }) => MockResponse | Promise<MockResponse>;

export interface MockSupabaseOptions {
  rpc?: Record<string, RpcHandler>;
  /** 테이블 op 별 핸들러 — 미지정 시 기본 { data: null, error: null } 반환 */
  table?: TableOpHandler;
}

export function makeMockSupabase(opts: MockSupabaseOptions = {}): SupabaseClient {
  const defaultTable: TableOpHandler = () => ({ data: null, error: null });
  const tableHandler = opts.table ?? defaultTable;

  function buildBuilder(tableName: string) {
    const ctx = { tableName, op: "select", filters: {} as Record<string, unknown>, payload: undefined as unknown };

    const exec = async () => Promise.resolve(tableHandler({ ...ctx }));

    const chain: Record<string, unknown> = {
      select: vi.fn((_cols?: string) => chain),
      insert: vi.fn((data: unknown) => {
        ctx.op = "insert";
        ctx.payload = data;
        return chain;
      }),
      update: vi.fn((data: unknown) => {
        ctx.op = "update";
        ctx.payload = data;
        return chain;
      }),
      delete: vi.fn(() => {
        ctx.op = "delete";
        return chain;
      }),
      upsert: vi.fn((data: unknown) => {
        ctx.op = "upsert";
        ctx.payload = data;
        return chain;
      }),
      eq: vi.fn((k: string, v: unknown) => {
        ctx.filters[k] = v;
        return chain;
      }),
      in: vi.fn((k: string, v: unknown[]) => {
        ctx.filters[k] = v;
        return chain;
      }),
      maybeSingle: vi.fn(() => exec()),
      single: vi.fn(() => exec()),
      then: vi.fn((resolve: (r: unknown) => void) => exec().then(resolve)),
    };
    // insert/update 가 .select() 체이닝 후 .single()/.maybeSingle() 호출되는 패턴
    return chain;
  }

  const mock = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      const handler = opts.rpc?.[name];
      if (!handler) {
        return { data: null, error: { message: `unmocked rpc: ${name}` } };
      }
      return await handler(args);
    }),
    from: vi.fn((tableName: string) => buildBuilder(tableName)),
  };
  return mock as unknown as SupabaseClient;
}

export function setupTestEnv(extra: Record<string, string> = {}): void {
  process.env.NODE_ENV = "test";
  process.env.SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key-1234567890";
  process.env.SUPABASE_JWT_SECRET = "test-jwt-secret-must-be-long-enough-1234567890";
  process.env.INTERNAL_TASK_SECRET = "test-internal-secret-1234567890";
  process.env.MOCK_PROVIDERS = "true";
  process.env.ALIGO_SENDER_DEFAULT = "0212345678";
  for (const [k, v] of Object.entries(extra)) process.env[k] = v;
  resetConfigCache();
}

export function injectSupabase(mock: SupabaseClient): void {
  setSupabaseForTest(mock);
}

export function clearSupabase(): void {
  setSupabaseForTest(null);
}

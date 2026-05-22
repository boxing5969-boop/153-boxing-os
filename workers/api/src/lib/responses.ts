import type { Context } from "hono";

type SuccessStatus = 200 | 201 | 202;
type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 501;

export function ok<T>(c: Context, data: T): Response;
export function ok<T>(c: Context, data: T, status: SuccessStatus): Response;
export function ok<T>(c: Context, data: T, message: string, status?: SuccessStatus): Response;
export function ok<T>(
  c: Context,
  data: T,
  arg3?: string | SuccessStatus,
  arg4?: SuccessStatus,
): Response {
  const message = typeof arg3 === "string" ? arg3 : undefined;
  const status: SuccessStatus = typeof arg3 === "number" ? arg3 : (arg4 ?? 200);
  return c.json({ success: true, data, ...(message ? { message } : {}) }, status);
}

export const fail = (c: Context, code: string, message: string, status: ErrorStatus = 400) =>
  c.json({ success: false, error: { code, message } }, status);

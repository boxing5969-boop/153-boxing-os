import type { Context } from "hono";

type ErrorStatus = 400 | 401 | 403 | 404 | 422 | 429 | 500 | 501;

export const ok = <T>(c: Context, data: T, message?: string) =>
  c.json({ success: true, data, ...(message ? { message } : {}) });

export const fail = (c: Context, code: string, message: string, status: ErrorStatus = 400) =>
  c.json({ success: false, error: { code, message } }, status);

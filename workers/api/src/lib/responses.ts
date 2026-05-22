import type { Context } from "hono";

type SuccessStatus = 200 | 201;
type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 501;

export const ok = <T>(c: Context, data: T, message?: string, status: SuccessStatus = 200) =>
  c.json({ success: true, data, ...(message ? { message } : {}) }, status);

export const fail = (c: Context, code: string, message: string, status: ErrorStatus = 400) =>
  c.json({ success: false, error: { code, message } }, status);

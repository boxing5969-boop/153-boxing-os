import type { MiddlewareHandler } from "hono";
import { jwtVerify } from "jose";
import type { Env } from "../lib/env";
import { fail } from "../lib/responses";

export interface JwtUser {
  id: string;
  email?: string;
  role?: string;
}

declare module "hono" {
  interface ContextVariableMap {
    user: JwtUser;
  }
}

export const requireJwt: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return fail(c, "AUTH_REQUIRED", "Authorization header missing", 401);
  }

  const token = auth.slice("Bearer ".length).trim();
  if (!c.env.SUPABASE_JWT_SECRET) {
    return fail(c, "INTERNAL_ERROR", "JWT secret not configured", 500);
  }

  try {
    const secret = new TextEncoder().encode(c.env.SUPABASE_JWT_SECRET);
    const { payload } = await jwtVerify(token, secret, {
      audience: "authenticated",
    });
    if (!payload.sub) {
      return fail(c, "AUTH_REQUIRED", "JWT payload missing sub", 401);
    }
    c.set("user", {
      id: payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
      role: typeof payload.role === "string" ? payload.role : undefined,
    });
    await next();
    return;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return fail(c, "AUTH_REQUIRED", `Invalid JWT: ${msg}`, 401);
  }
};

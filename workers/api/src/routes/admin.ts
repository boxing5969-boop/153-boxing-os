import { Hono } from "hono";
import type { Env } from "../lib/env";

export const adminRoutes = new Hono<{ Bindings: Env }>();

adminRoutes.post("/door/open", (c) =>
  c.json(
    {
      success: false,
      error: { code: "NOT_IMPLEMENTED", message: "Phase 4 에서 구현 예정" },
    },
    501
  )
);

import { Hono } from "hono";
import type { Env } from "../lib/env";

export const devicesRoutes = new Hono<{ Bindings: Env }>();

devicesRoutes.post("/sync-member", (c) =>
  c.json(
    {
      success: false,
      error: { code: "NOT_IMPLEMENTED", message: "Phase 4 에서 구현 예정" },
    },
    501
  )
);

devicesRoutes.post("/webhook", (c) =>
  c.json(
    {
      success: false,
      error: { code: "NOT_IMPLEMENTED", message: "Phase 4 에서 구현 예정" },
    },
    501
  )
);

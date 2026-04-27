import { Hono } from "hono";
import type { Env } from "../lib/env";

export const accessRoutes = new Hono<{ Bindings: Env }>();

accessRoutes.post("/verify", (c) =>
  c.json(
    {
      success: false,
      error: { code: "NOT_IMPLEMENTED", message: "Phase 4 에서 구현 예정" },
    },
    501
  )
);

accessRoutes.post("/qr/generate", (c) =>
  c.json(
    {
      success: false,
      error: { code: "NOT_IMPLEMENTED", message: "Phase 4 에서 구현 예정" },
    },
    501
  )
);

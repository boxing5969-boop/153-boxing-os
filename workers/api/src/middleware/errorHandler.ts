import type { ErrorHandler } from "hono";
import type { Env } from "../lib/env";

export const errorHandler: ErrorHandler<{ Bindings: Env }> = (err, c) => {
  console.error("[unhandled]", err);
  return c.json(
    {
      success: false,
      error: { code: "INTERNAL_ERROR", message: err.message ?? "Unknown error" },
    },
    500
  );
};

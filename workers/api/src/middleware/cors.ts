import { cors } from "hono/cors";

export const corsMiddleware = cors({
  origin: ["http://localhost:5173"],
  credentials: true,
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "X-Device-Id", "X-Signature", "X-Timestamp"],
});

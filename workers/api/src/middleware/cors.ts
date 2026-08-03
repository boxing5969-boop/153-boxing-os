import { cors } from "hono/cors";

/**
 * 허용 origin:
 *   - http://localhost:5173 (Vite 개발)
 *   - https://153-boxing-os.pages.dev (운영)
 *   - https://<branch>.153-boxing-os.pages.dev (Cloudflare Pages preview/branch 빌드)
 */
function isAllowedOrigin(origin: string): boolean {
  if (origin === "http://localhost:5173") return true;
  if (origin === "https://153-boxing-os.pages.dev") return true;
  if (/^https:\/\/[a-z0-9-]+\.153-boxing-os\.pages\.dev$/i.test(origin)) return true;
  if (origin === "https://153-branch-report.pages.dev") return true;
  if (/^https:\/\/[a-z0-9-]+\.153-branch-report\.pages\.dev$/i.test(origin)) return true;
  // 마이복서153 앱 — 얼굴 키오스크(/face-kiosk)가 /api/face/* 를 호출한다 (FC-2)
  if (origin === "https://game-fit-quests.pages.dev") return true;
  if (/^https:\/\/[a-z0-9-]+\.game-fit-quests\.pages\.dev$/i.test(origin)) return true;
  return false;
}

export const corsMiddleware = cors({
  origin: (origin) => (isAllowedOrigin(origin) ? origin : null),
  credentials: true,
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: [
    "Content-Type",
    "Authorization",
    "X-Device-Id",
    "X-Signature",
    "X-Timestamp",
    "X-Partner-Key",
    "X-Ranking-User-Id", "X-Kiosk-Key",
  ],
});

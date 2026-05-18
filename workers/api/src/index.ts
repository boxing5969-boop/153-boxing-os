import * as Sentry from "@sentry/cloudflare";
import { Hono } from "hono";
import { corsMiddleware } from "./middleware/cors";
import { errorHandler } from "./middleware/errorHandler";
import { accessRoutes } from "./routes/access";
import { devicesRoutes } from "./routes/devices";
import { adminRoutes } from "./routes/admin";
import { staffRoutes } from "./routes/staff";
import { externalRoutes } from "./routes/external";
import { onboardingRoutes } from "./routes/onboarding";
import { hrRoutes } from "./routes/hr";
import {
  processNextSyncJobs,
  runDailyExpiry,
  runQrCleanup,
  runScheduledMessages,
} from "./services/syncQueueProcessor";
import { runAlertCheck } from "./services/alertChecker";
import type { Env } from "./lib/env";

const app = new Hono<{ Bindings: Env }>();

app.use("*", corsMiddleware);
app.onError(errorHandler);

app.get("/health", (c) =>
  c.json({
    success: true,
    data: { ok: true, environment: c.env.ENVIRONMENT, time: new Date().toISOString() },
  })
);

app.route("/api/access", accessRoutes);
app.route("/api/devices", devicesRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/staff", staffRoutes);
app.route("/api/external", externalRoutes);
app.route("/api/onboarding", onboardingRoutes);
app.route("/api/hr", hrRoutes);

app.notFound((c) =>
  c.json({ success: false, error: { code: "NOT_FOUND", message: "Route not found" } }, 404)
);

const DAILY_EXPIRY_CRON      = "5 15 * * *";   // 00:05 KST = 15:05 UTC
const QR_CLEANUP_CRON        = "*/10 * * * *";
const ALERT_CHECK_CRON       = "*/5 * * * *";
const SCHEDULED_MSG_CRON     = "0 * * * *";    // 매시간 정각 — 예약 발송 처리

async function handleScheduled(
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  if (controller.cron === DAILY_EXPIRY_CRON) {
    ctx.waitUntil(runDailyExpiry(env));
    return;
  }
  if (controller.cron === QR_CLEANUP_CRON) {
    ctx.waitUntil(runQrCleanup(env));
    return;
  }
  if (controller.cron === ALERT_CHECK_CRON) {
    ctx.waitUntil(
      runAlertCheck(env).then((report) =>
        console.log("[scheduled:alerts]", report)
      )
    );
    return;
  }
  if (controller.cron === SCHEDULED_MSG_CRON) {
    ctx.waitUntil(
      runScheduledMessages(env).then(() =>
        console.log("[scheduled:messages] done")
      )
    );
    return;
  }
  // every minute fallback — sync queue
  ctx.waitUntil(
    processNextSyncJobs(env, 50).then((report) =>
      console.log("[scheduled:sync]", report)
    )
  );
}

const handler: ExportedHandler<Env> = {
  fetch: app.fetch as ExportedHandlerFetchHandler<Env>,
  scheduled: handleScheduled,
};

// Sentry — DSN 미설정 시 자동으로 no-op (enabled: false)
export default Sentry.withSentry(
  (env: Env) => ({
    dsn: env.SENTRY_DSN,
    enabled: !!env.SENTRY_DSN,
    environment: env.ENVIRONMENT,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  }),
  handler
);

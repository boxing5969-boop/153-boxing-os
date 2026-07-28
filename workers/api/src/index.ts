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
import { classesRoutes } from "./routes/classes";
import { fitnessRoutes } from "./routes/fitness";
import { surveysRoutes } from "./routes/surveys";
import { fcRoutes } from "./routes/fc";
import { dailyReportsRoutes } from "./routes/dailyReports";
import { branchAppRoutes } from "./routes/branchApp";
import { paymentsRoutes } from "./routes/payments";
import { brojRoutes } from "./routes/broj";
import { feedbackRoutes } from "./routes/feedback";
import { certRoutes } from "./routes/cert";
import {
  processNextSyncJobs,
  runDailyExpiry,
  runFcDailyRun,
  runQrCleanup,
  runScheduledMessages,
} from "./services/syncQueueProcessor";
import { runAlertCheck } from "./services/alertChecker";
import { runDailyReport } from "./services/dailyReporter";
import { runResumeDueHolds } from "./services/holdResume";
import { runAutomationDaily } from "./services/automationRunner";
import { runDailyAutomationReport } from "./services/dailyAutomationReport";
import { runBrojAutoSync } from "./services/brojAutoSync";
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
app.route("/api/admin/surveys", surveysRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/staff", staffRoutes);
app.route("/api/external", externalRoutes);
app.route("/api/onboarding", onboardingRoutes);
app.route("/api/hr", hrRoutes);
app.route("/api/classes", classesRoutes);
app.route("/api/fitness", fitnessRoutes);
app.route("/api/fc", fcRoutes);
app.route("/api/reports", dailyReportsRoutes);
app.route("/api/branch-app", branchAppRoutes);
app.route("/api/payments", paymentsRoutes);
app.route("/api/broj", brojRoutes);
app.route("/api/feedback", feedbackRoutes);
app.route("/api/cert", certRoutes);

app.notFound((c) =>
  c.json({ success: false, error: { code: "NOT_FOUND", message: "Route not found" } }, 404)
);

const DAILY_EXPIRY_CRON      = "5 15 * * *";   // 00:05 KST — 만료 처리 + 알림 + 일일 리포트
const QR_CLEANUP_CRON        = "*/10 * * * *";
const ALERT_CHECK_CRON       = "*/5 * * * *";
const SCHEDULED_MSG_CRON     = "0 * * * *";    // 매시간 정각 — 예약 발송 처리

async function handleScheduled(
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  if (controller.cron === DAILY_EXPIRY_CRON) {
    // 만료 처리 + 알림톡 + 브로제이 동기화 + 일일 리포트 SMS + FC 일배치 (순차)
    ctx.waitUntil(
      runDailyExpiry(env)
        .then(() => runResumeDueHolds(env))
        .then((r) => {
          console.log("[scheduled:resumeHolds]", r);
        })
        // 브로제이 동기화는 일일 리포트 '직전'에 — 리포트 숫자가 브로제이 실시간 값과 같아진다.
        // 실패해도 체인을 끊지 않는다(리포트·자동발송이 더 중요).
        .then(() =>
          runBrojAutoSync(env)
            .then((r) => console.log("[scheduled:brojSync]", JSON.stringify(r)))
            .catch((e) => console.error("[scheduled:brojSync]", e))
        )
        .then(() => runDailyReport(env))
        .then(() => {
          console.log("[scheduled:dailyReport] done");
        })
        .then(() => runFcDailyRun(env))
        .then(() => {
          console.log("[scheduled:fcDailyRun] done");
        })
    );
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
    // 두 작업을 독립 실행 — 예약발송이 실패해도 완전 자동화(유료) 발송이 막히지 않게 한다.
    ctx.waitUntil(
      runScheduledMessages(env)
        .then(() => console.log("[scheduled:messages] done"))
        .catch((e) => console.error("[scheduled:messages]", e))
    );
    ctx.waitUntil(
      runAutomationDaily(env)    // 지점별 send_hour 에만 실제 발송
        .then(() => console.log("[scheduled:automation] done"))
        .catch((e) => console.error("[scheduled:automation]", e))
    );
    ctx.waitUntil(
      runDailyAutomationReport(env)   // KST 11시에만 — 대표님께 일일 자동관리 리포트(카카오→문자)
        .then(() => console.log("[scheduled:autoReport] done"))
        .catch((e) => console.error("[scheduled:autoReport]", e))
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

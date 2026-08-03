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
import { sparringConsentRoutes } from "./routes/sparringConsent";
import { guestPassRoutes } from "./routes/guestPass";
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
import { runBrojAutoSync, runBrojAttendanceSync, runBrojAttendanceBackfill, runHoldsSweep } from "./services/brojAutoSync";
import { faceAccessRoutes } from "./routes/faceAccess";
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
app.route("/api/face", faceAccessRoutes);
app.route("/api/feedback", feedbackRoutes);
app.route("/api/sparring", sparringConsentRoutes);
app.route("/api/guest-pass", guestPassRoutes);
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
        // ※ 시스템 점검 보고는 여기서 따로 보내지 않는다.
        //   대표님은 카톡 한 통으로 보길 원하셔서 11시 '자동관리 리포트'에 본문을 합쳤다
        //   (dailyAutomationReport → buildHealthReport). 리포트를 쪼개면 알림만 늘고 안 읽힌다.
    );
    // 출석 깊은 백필 — 하루 한 지점씩 최근 60일 재수집(매시간 3일 창이 놓친 구멍 메우기).
    // ⚠️ 위 체인에 붙이지 않는다: 앞 단계(만료·리포트·FC) 중 하나가 reject 하면 .then 이 끊겨
    //    백필이 통째로 건너뛰어지고 그날 로테이션이 통으로 밀린다. 독립 실행이 안전하다.
    ctx.waitUntil(
      runBrojAttendanceBackfill(env)
        .then((r) => console.log("[scheduled:attBackfill]", JSON.stringify(r)))
        .catch((e) => console.error("[scheduled:attBackfill]", e))
    );
    return;
  }
  if (controller.cron === QR_CLEANUP_CRON) {
    ctx.waitUntil(runQrCleanup(env));
    // 🚨 서브리퀘스트 한도(무료 50)는 **크론 이벤트 1회(invocation) 단위**이고, 같은 이벤트 안의
    //    waitUntil 여러 개는 예산을 **공유**한다(예전 주석 "쪼개면 따로 받는다"는 틀렸다 — 실측으로
    //    홀딩 스윕이 18명 중 13명에서 끊기고, 10·11시엔 4~6명까지 떨어지는 걸로 증명됨).
    //    그래서 무거운 매시간 작업 둘을 이 */10 크론의 **다른 분(minute) 슬롯**으로 옮겨
    //    각자 온전한 예산 50을 받게 한다. QR 정리는 1~2콜뿐이라 동거해도 넉넉하다.
    const minute = new Date(controller.scheduledTime).getUTCMinutes();
    if (minute === 20) {
      // :20 — 출석 매시간 동기화 (지점당 2~3콜 + 통계 1 ≈ 17콜)
      ctx.waitUntil(
        runBrojAttendanceSync(env)
          .then((r) => console.log("[scheduled:attendance]", JSON.stringify(r)))
          .catch((e) => console.error("[scheduled:attendance]", e))
      );
    } else if (minute === 40) {
      // :40 — 홀딩(일시정지) 스윕 (18명×2콜 + 고정 6콜 ≈ 42콜, 예산 50 안)
      ctx.waitUntil(
        runHoldsSweep(env)
          .then((r) => console.log("[scheduled:holds]", JSON.stringify(r)))
          .catch((e) => console.error("[scheduled:holds]", e))
      );
    }
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
    // ※ 출석 매시간 동기화(:20)와 홀딩 스윕(:40)은 QR_CLEANUP(*/10) 크론의 분 슬롯으로 옮겼다.
    //   여기(정각)에 같이 두면 예약발송·자동발송·11시 리포트와 서브리퀘스트 50을 나눠 써
    //   서로를 굶긴다(위 QR_CLEANUP 분기 주석 참고).
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

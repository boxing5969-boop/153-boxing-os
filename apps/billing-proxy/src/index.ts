/**
 * billing-proxy entry point — Express 앱 부트스트랩 + Cloud Run 라이프사이클.
 */
import express from "express";
import { randomUUID } from "node:crypto";
import { loadConfig } from "./config";
import { logger } from "./lib/logger";
import { errorHandler } from "./lib/errors";
import { healthRouter } from "./routes/health";
import { messagesRouter } from "./routes/messages";
import { invoicesRouter } from "./routes/invoices";
import { webhooksPayssamRouter } from "./routes/webhooksPayssam";
import { tasksMessagesRouter } from "./routes/tasksMessages";

export function buildApp(): express.Express {
  const app = express();

  // raw body 보존 (webhook 서명 검증용)
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: string }).rawBody = buf.toString("utf8");
      },
    })
  );

  // request id + 기본 로깅
  app.use((req, res, next) => {
    const requestId = req.header("x-request-id") ?? randomUUID();
    (req as express.Request & { requestId?: string }).requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    const start = Date.now();
    res.on("finish", () => {
      logger.info(
        {
          requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms: Date.now() - start,
        },
        "request"
      );
    });
    next();
  });

  app.use(healthRouter());
  app.use(messagesRouter());
  app.use(invoicesRouter());
  app.use(webhooksPayssamRouter());
  app.use(tasksMessagesRouter());

  // 404
  app.use((_req, res) => {
    res.status(404).json({ ok: false, code: "NOT_FOUND", message: "endpoint not found" });
  });

  app.use(errorHandler);

  return app;
}

function start(): void {
  const cfg = loadConfig();
  const app = buildApp();
  const server = app.listen(cfg.PORT, () => {
    logger.info({ port: cfg.PORT, env: cfg.NODE_ENV, mock: cfg.MOCK_PROVIDERS }, "billing-proxy listening");
  });

  // Graceful shutdown (Cloud Run SIGTERM)
  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    server.close(() => {
      logger.info("server closed");
      process.exit(0);
    });
    setTimeout(() => {
      logger.warn("forced exit after 10s");
      process.exit(1);
    }, 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

if (require.main === module) {
  start();
}

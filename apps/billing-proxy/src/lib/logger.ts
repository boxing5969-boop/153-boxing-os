import pino from "pino";
import { loadConfig } from "../config";

const cfg = (() => {
  try {
    return loadConfig();
  } catch {
    // 설정 검증 전(부팅 초기)에도 로거 사용 가능하게 fallback
    return { LOG_LEVEL: (process.env.LOG_LEVEL ?? "info") as pino.LevelWithSilent, NODE_ENV: process.env.NODE_ENV ?? "development" };
  }
})();

export const logger = pino({
  level: cfg.LOG_LEVEL ?? "info",
  base: { service: "billing-proxy" },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Cloud Run 은 stdout JSON 을 그대로 Logging 으로 수집
  transport:
    cfg.NODE_ENV === "development"
      ? {
          target: "pino/file",
          options: { destination: 1, ignore: "pid,hostname" },
        }
      : undefined,
});

export type Logger = typeof logger;

/**
 * Queue factory — 환경에 따라 LocalImmediate 또는 CloudTasks 선택.
 *
 * 운영(production) + CLOUD_TASKS_PROJECT_ID 설정 시 → CloudTasksQueue
 * 그 외 (dev/test, mock, 설정 누락) → LocalImmediateQueue
 *
 * Local 큐는 처리 함수가 직접 필요 — processMessageJob/processInvoiceJob 을 받음.
 */
import { loadConfig } from "../config";
import { logger } from "../lib/logger";
import { LocalImmediateQueue, type ImmediateProcessor } from "./localQueue";
import { CloudTasksQueue, type CloudTasksClientLike } from "./cloudTasksQueue";
import type { JobQueue } from "./types";

let cached: JobQueue | null = null;

export interface QueueDeps {
  messageProcessor: ImmediateProcessor;
  invoiceProcessor: ImmediateProcessor;
  /** 테스트용 — Cloud Tasks 클라이언트 주입 */
  cloudTasksClientFactory?: () => Promise<CloudTasksClientLike>;
}

export function buildQueue(deps: QueueDeps): JobQueue {
  if (cached && process.env.NODE_ENV !== "test") return cached;

  const cfg = loadConfig();
  const hasCloudTasks =
    cfg.NODE_ENV === "production" &&
    !cfg.MOCK_PROVIDERS &&
    !!cfg.CLOUD_TASKS_PROJECT_ID &&
    !!cfg.CLOUD_TASKS_LOCATION &&
    !!cfg.CLOUD_TASKS_QUEUE_MESSAGES &&
    !!cfg.CLOUD_TASKS_QUEUE_INVOICES &&
    !!cfg.CLOUD_RUN_BASE_URL &&
    !!cfg.OIDC_INVOKER_SERVICE_ACCOUNT;

  if (hasCloudTasks) {
    cached = new CloudTasksQueue(
      {
        projectId: cfg.CLOUD_TASKS_PROJECT_ID!,
        location: cfg.CLOUD_TASKS_LOCATION!,
        messageQueue: cfg.CLOUD_TASKS_QUEUE_MESSAGES!,
        invoiceQueue: cfg.CLOUD_TASKS_QUEUE_INVOICES!,
        cloudRunBaseUrl: cfg.CLOUD_RUN_BASE_URL!,
        oidcAudience: cfg.CLOUD_RUN_BASE_URL!,
        oidcServiceAccountEmail: cfg.OIDC_INVOKER_SERVICE_ACCOUNT!,
      },
      deps.cloudTasksClientFactory
    );
    logger.info({ project: cfg.CLOUD_TASKS_PROJECT_ID, location: cfg.CLOUD_TASKS_LOCATION }, "using CloudTasksQueue");
  } else {
    cached = new LocalImmediateQueue(deps.messageProcessor, deps.invoiceProcessor);
    logger.info("using LocalImmediateQueue (dev/test/mock)");
  }
  return cached;
}

export function resetQueueCache(): void {
  cached = null;
}

export function injectQueueForTest(queue: JobQueue): void {
  cached = queue;
}

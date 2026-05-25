/**
 * Google Cloud Tasks 어댑터.
 *
 * 운영에서:
 *   - Cloud Tasks 큐가 /tasks/messages/process (또는 /tasks/invoices/process) 로 HTTP POST
 *   - OIDC 토큰을 Authorization 헤더에 자동 첨부 (Cloud Tasks 가 발급)
 *   - 받는 쪽 (이 서비스) 는 토큰 검증 (verifyInternalTask)
 *
 * 실 SDK 호출은 @google-cloud/tasks 의 CloudTasksClient.createTask 를 사용.
 * SDK 가 ADC 로 인증하므로 Cloud Run 환경에선 자동 동작, 로컬에선 GOOGLE_APPLICATION_CREDENTIALS 필요.
 *
 * 멱등성: taskName 을 지정하면 Cloud Tasks 가 중복 enqueue 거부 (ALREADY_EXISTS).
 *         같은 jobId 로 두 번 enqueue 해도 안전.
 */
import type { EnqueueOptions, EnqueueResult, JobQueue } from "./types";
import { logger } from "../lib/logger";

export interface CloudTasksConfig {
  projectId: string;
  location: string;
  messageQueue: string;
  invoiceQueue: string;
  /** 본 서비스 URL — Cloud Tasks 가 콜백할 base URL */
  cloudRunBaseUrl: string;
  /** OIDC audience — 보통 cloudRunBaseUrl 과 동일 */
  oidcAudience: string;
  /** OIDC 토큰 발급에 사용할 서비스 계정 이메일 (Cloud Tasks 가 이 SA 권한으로 토큰 발급) */
  oidcServiceAccountEmail: string;
}

/** task name 안전 변환 — Cloud Tasks 허용 charset: [A-Za-z0-9_-], 최대 500 chars */
function sanitizeTaskName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 200);
}

export class CloudTasksQueue implements JobQueue {
  constructor(
    private readonly cfg: CloudTasksConfig,
    /** 테스트용 — SDK 클라이언트 주입 가능 */
    private readonly clientFactory?: () => Promise<CloudTasksClientLike>
  ) {}

  private async getClient(): Promise<CloudTasksClientLike> {
    if (this.clientFactory) return this.clientFactory();
    // 동적 import — @google-cloud/tasks 가 무거우므로 운영에서만 로드
    const mod = (await import("@google-cloud/tasks")) as unknown as {
      CloudTasksClient: new () => CloudTasksClientLike;
    };
    return new mod.CloudTasksClient();
  }

  private async enqueue(
    queueName: string,
    targetPath: string,
    jobId: string,
    opts: EnqueueOptions
  ): Promise<EnqueueResult> {
    const client = await this.getClient();
    const parent = `projects/${this.cfg.projectId}/locations/${this.cfg.location}/queues/${queueName}`;

    const taskNameShort = sanitizeTaskName(opts.taskName ?? `${targetPath.replace(/\//g, "_")}_${jobId}`);
    const fullTaskName = `${parent}/tasks/${taskNameShort}`;

    const url = `${this.cfg.cloudRunBaseUrl.replace(/\/$/, "")}${targetPath}`;
    const body = Buffer.from(JSON.stringify({ message_job_id: jobId })).toString("base64");

    const scheduleTime =
      opts.delayMs && opts.delayMs > 0
        ? { seconds: Math.floor((Date.now() + opts.delayMs) / 1000) }
        : undefined;

    const task = {
      name: fullTaskName,
      httpRequest: {
        httpMethod: "POST" as const,
        url,
        headers: { "Content-Type": "application/json" },
        body,
        oidcToken: {
          serviceAccountEmail: this.cfg.oidcServiceAccountEmail,
          audience: this.cfg.oidcAudience,
        },
      },
      ...(scheduleTime ? { scheduleTime } : {}),
    };

    try {
      const [response] = await client.createTask({ parent, task });
      logger.info({ jobId, taskName: response.name }, "cloud task enqueued");
      return { taskName: response.name ?? fullTaskName, provider: "cloud_tasks" };
    } catch (err) {
      const e = err as { code?: number; message?: string };
      // ALREADY_EXISTS (6) — 멱등 — 같은 jobId 로 재시도 OK
      if (e.code === 6) {
        logger.info({ jobId, taskName: fullTaskName }, "cloud task already exists (idempotent)");
        return { taskName: fullTaskName, provider: "cloud_tasks" };
      }
      throw err;
    }
  }

  async enqueueMessageProcess(jobId: string, opts: EnqueueOptions = {}): Promise<EnqueueResult> {
    return this.enqueue(this.cfg.messageQueue, "/tasks/messages/process", jobId, opts);
  }

  async enqueueInvoiceProcess(jobId: string, opts: EnqueueOptions = {}): Promise<EnqueueResult> {
    return this.enqueue(this.cfg.invoiceQueue, "/tasks/invoices/process", jobId, opts);
  }
}

/** @google-cloud/tasks 의 CloudTasksClient 일부 — 테스트 mock 용 */
export interface CloudTasksClientLike {
  createTask(req: {
    parent: string;
    task: {
      name?: string;
      httpRequest: {
        httpMethod: "POST";
        url: string;
        headers?: Record<string, string>;
        body?: string;
        oidcToken?: { serviceAccountEmail: string; audience?: string };
      };
      scheduleTime?: { seconds: number };
    };
  }): Promise<[{ name?: string }, unknown, unknown]>;
}

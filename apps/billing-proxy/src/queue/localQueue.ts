/**
 * LocalImmediateQueue — dev/test 용.
 *
 * 동작: enqueue 즉시 in-process 로 처리 함수 호출.
 * 운영 큐가 아니라서 retry/backoff 없음. 실패는 호출자에게 throw.
 *
 * 참고: 이 큐가 호출하는 처리 함수는 새 Express 요청 컨텍스트가 아님 — 직접 worker 함수만.
 *      그래서 시그니처를 단순하게 (jobId) → Promise<void>.
 */
import type { EnqueueOptions, EnqueueResult, JobQueue } from "./types";
import { logger } from "../lib/logger";

export type ImmediateProcessor = (jobId: string) => Promise<void>;

export class LocalImmediateQueue implements JobQueue {
  constructor(
    private readonly messageProcessor: ImmediateProcessor,
    private readonly invoiceProcessor: ImmediateProcessor
  ) {}

  async enqueueMessageProcess(jobId: string, opts: EnqueueOptions = {}): Promise<EnqueueResult> {
    const name = opts.taskName ?? `local-msg-${jobId}`;
    if (opts.delayMs && opts.delayMs > 0) {
      setTimeout(() => {
        this.messageProcessor(jobId).catch((err) => {
          logger.error({ jobId, err: err instanceof Error ? err.message : err }, "local message processor failed");
        });
      }, opts.delayMs).unref();
    } else {
      // 즉시 처리 — 실패 시 호출자에게 throw 하지 않고 로그만 (큐 의미 보존)
      this.messageProcessor(jobId).catch((err) => {
        logger.error({ jobId, err: err instanceof Error ? err.message : err }, "local message processor failed");
      });
    }
    return { taskName: name, provider: "local_immediate" };
  }

  async enqueueInvoiceProcess(jobId: string, opts: EnqueueOptions = {}): Promise<EnqueueResult> {
    const name = opts.taskName ?? `local-inv-${jobId}`;
    if (opts.delayMs && opts.delayMs > 0) {
      setTimeout(() => {
        this.invoiceProcessor(jobId).catch((err) => {
          logger.error({ jobId, err: err instanceof Error ? err.message : err }, "local invoice processor failed");
        });
      }, opts.delayMs).unref();
    } else {
      this.invoiceProcessor(jobId).catch((err) => {
        logger.error({ jobId, err: err instanceof Error ? err.message : err }, "local invoice processor failed");
      });
    }
    return { taskName: name, provider: "local_immediate" };
  }
}

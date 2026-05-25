/**
 * 작업 큐 추상화 — 운영에서는 Google Cloud Tasks, dev/test 는 in-process 즉시 처리.
 *
 * 패턴:
 *   1) 와이즈한 호출자 (sendBulkMessages 등) 가 wallet 차감 + DB row 생성
 *   2) queue.enqueueMessageProcess(jobId) 호출 — 외부 큐로 위임
 *   3) 큐가 일정 후 우리의 /tasks/messages/process 엔드포인트 호출
 *   4) /tasks 핸들러가 실제 Aligo/Payssam 호출 (이미 wallet 차감됐으므로 실패 시 환불만 처리)
 */
export interface JobQueue {
  /** 메시지 발송 job 을 큐에 적재. delay 지정 시 그 이후 처리. */
  enqueueMessageProcess(jobId: string, opts?: EnqueueOptions): Promise<EnqueueResult>;

  /** 청구서 발송 job 을 큐에 적재. */
  enqueueInvoiceProcess(jobId: string, opts?: EnqueueOptions): Promise<EnqueueResult>;
}

export interface EnqueueOptions {
  /** 지연 ms (Cloud Tasks scheduleTime 으로 변환) */
  delayMs?: number;
  /** Cloud Tasks 측 task name (멱등성 보장) — 미지정 시 자동 생성 */
  taskName?: string;
}

export interface EnqueueResult {
  /** 큐 측 식별자 (Cloud Tasks 의 task name 또는 local 모의 ID) */
  taskName: string;
  /** 'cloud_tasks' | 'local_immediate' 등 */
  provider: string;
}

/**
 * Cloud Tasks 컨슈머: message_jobs 큐.
 *
 * 처리 로직은 messages/processMessageJob 으로 통일 — LocalImmediateQueue 와 같은 함수 호출.
 * 큐 재시도 의미를 위해:
 *   - 일시 실패 → 503 (Cloud Tasks 가 자동 재시도)
 *   - 영구 실패(이미 환불됨) → 200 (재시도 중단)
 *   - 성공 → 200
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { ValidationError } from "../lib/errors";
import { verifyInternalTask } from "../auth/verifyInternalTask";
import { ProcessMessageTaskSchema } from "../validation/schemas";
import { processMessageJob } from "../messages/processMessageJob";

export function tasksMessagesRouter(): Router {
  const r = Router();

  r.post("/tasks/messages/process", verifyInternalTask, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = ProcessMessageTaskSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError("invalid task payload", parsed.error.issues);

      const result = await processMessageJob(parsed.data.message_job_id);

      if (!result.ok && result.retryable) {
        res.status(503).json({ ok: false, retry: true, reason: result.reason });
        return;
      }
      res.json({ ok: result.ok, status: result.status, reason: result.reason });
    } catch (err) {
      next(err);
    }
  });

  return r;
}

/**
 * Cloud Tasks 컨슈머: service_invoices 큐.
 * processInvoiceJob() 호출 후 결과에 따라 200/503 반환.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { ValidationError } from "../lib/errors";
import { verifyInternalTask } from "../auth/verifyInternalTask";
import { ProcessInvoiceTaskSchema } from "../validation/schemas";
import { processInvoiceJob } from "../invoices/processInvoiceJob";

export function tasksInvoicesRouter(): Router {
  const r = Router();

  r.post("/tasks/invoices/process", verifyInternalTask, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = ProcessInvoiceTaskSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError("invalid task payload", parsed.error.issues);
      const { message_job_id: invoiceId } = parsed.data;

      const result = await processInvoiceJob(invoiceId);

      // 영구 실패라도 200 — Cloud Tasks 재시도 중단
      if (!result.ok && result.retryable) {
        // 일시 실패 — 503 으로 큐가 재시도하게
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

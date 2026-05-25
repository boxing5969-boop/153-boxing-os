import { Router, type Request, type Response, type NextFunction } from "express";
import { AuthError, ValidationError } from "../lib/errors";
import { verifySupabaseUser } from "../auth/verifySupabaseUser";
import { assertTenantRole } from "../tenants/assertTenantRole";
import { SendBulkMessagesSchema } from "../validation/schemas";
import { sendBulkMessages } from "../messages/sendBulkMessages";
import type { JobQueue } from "../queue/types";

export function messagesBulkRouter(queue: JobQueue): Router {
  const r = Router();

  r.post("/api/messages/send-bulk", verifySupabaseUser, async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw new AuthError();
      const parsed = SendBulkMessagesSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError("invalid request body", parsed.error.issues);
      const input = parsed.data;

      await assertTenantRole(req.user.id, input.tenant_id, [
        "owner", "hq_admin", "super_admin", "branch_owner", "branch_manager",
      ]);

      const result = await sendBulkMessages(input, req.user.id, { queue });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return r;
}

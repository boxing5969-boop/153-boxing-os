import { Router, type Request, type Response, type NextFunction } from "express";
import { AuthError, ValidationError } from "../lib/errors";
import { verifySupabaseUser } from "../auth/verifySupabaseUser";
import { assertTenantRole } from "../tenants/assertTenantRole";
import { CreateBulkInvoicesSchema } from "../validation/schemas";
import { createBulkInvoices } from "../invoices/createBulkInvoices";
import type { JobQueue } from "../queue/types";

export function invoicesBulkRouter(queue: JobQueue): Router {
  const r = Router();

  r.post("/api/invoices/create-bulk", verifySupabaseUser, async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw new AuthError();
      const parsed = CreateBulkInvoicesSchema.safeParse(req.body);
      if (!parsed.success) throw new ValidationError("invalid request body", parsed.error.issues);
      const input = parsed.data;

      await assertTenantRole(req.user.id, input.tenant_id, [
        "owner", "hq_admin", "super_admin", "branch_owner", "branch_manager", "accountant",
      ]);

      const result = await createBulkInvoices(input, req.user.id, { queue });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return r;
}

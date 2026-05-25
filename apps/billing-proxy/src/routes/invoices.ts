import { Router, type Request, type Response, type NextFunction } from "express";
import { ValidationError, AuthError } from "../lib/errors";
import { verifySupabaseUser } from "../auth/verifySupabaseUser";
import { assertTenantRole } from "../tenants/assertTenantRole";
import { CreateInvoiceSchema } from "../validation/schemas";
import { createInvoice } from "../invoices/createInvoice";

export function invoicesRouter(): Router {
  const r = Router();

  r.post("/api/invoices/create", verifySupabaseUser, async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw new AuthError();
      const parsed = CreateInvoiceSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError("invalid request body", parsed.error.issues);
      }
      const input = parsed.data;

      await assertTenantRole(req.user.id, input.tenant_id, [
        "owner",
        "hq_admin",
        "super_admin",
        "branch_owner",
        "branch_manager",
        "accountant",
      ]);

      const result = await createInvoice(input, req.user.id);
      res.json({
        ok: result.ok,
        invoice_id: result.invoiceId,
        wallet_transaction_id: result.walletTransactionId,
        charged_krw: result.chargedKrw,
        balance_after_krw: result.balanceAfterKrw,
        provider_invoice_id: result.providerInvoiceId,
        payment_url: result.paymentUrl,
        status: result.status,
      });
    } catch (err) {
      next(err);
    }
  });

  return r;
}

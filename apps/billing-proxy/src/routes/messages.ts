import { Router, type Request, type Response, type NextFunction } from "express";
import { ValidationError, AuthError } from "../lib/errors";
import { verifySupabaseUser } from "../auth/verifySupabaseUser";
import { assertTenantRole } from "../tenants/assertTenantRole";
import { SendMessageSchema } from "../validation/schemas";
import { sendMessage } from "../messages/sendMessage";

export function messagesRouter(): Router {
  const r = Router();

  r.post("/api/messages/send", verifySupabaseUser, async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw new AuthError();
      const parsed = SendMessageSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError("invalid request body", parsed.error.issues);
      }
      const input = parsed.data;

      // 사용자가 해당 tenant 에서 메시지 발송 권한 보유 검증
      await assertTenantRole(req.user.id, input.tenant_id, [
        "owner",
        "hq_admin",
        "super_admin",
        "branch_owner",
        "branch_manager",
        "staff",
        "coach",
      ]);

      const result = await sendMessage(input, req.user.id);
      res.json({
        ok: result.ok,
        message_job_id: result.messageJobId,
        wallet_transaction_id: result.walletTransactionId,
        charged_krw: result.chargedKrw,
        balance_after_krw: result.balanceAfterKrw,
        provider_message_id: result.providerMessageId,
        status: result.status,
        message: result.resultMessage,
      });
    } catch (err) {
      next(err);
    }
  });

  return r;
}

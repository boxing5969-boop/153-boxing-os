/**
 * 도메인 에러 클래스 + Express 에러 핸들러.
 * 모든 의도된 실패는 AppError 로 throw → 핸들러가 안전한 JSON 응답.
 */
import type { NextFunction, Request, Response } from "express";
import { logger } from "./logger";

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class AuthError extends AppError {
  constructor(message = "unauthorized", details?: unknown) {
    super("UNAUTHORIZED", message, 401, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "forbidden", details?: unknown) {
    super("FORBIDDEN", message, 403, details);
  }
}

export class ValidationError extends AppError {
  constructor(message = "validation failed", details?: unknown) {
    super("VALIDATION_FAILED", message, 422, details);
  }
}

export class WalletError extends AppError {
  constructor(code: "INSUFFICIENT_BALANCE" | "WALLET_NOT_FOUND" | "WALLET_SUSPENDED" | "WALLET_ERROR", message: string, details?: unknown) {
    super(code, message, 402, details); // 402 = payment required
  }
}

export class ProviderError extends AppError {
  constructor(provider: string, message: string, details?: unknown) {
    super("PROVIDER_FAILED", `${provider}: ${message}`, 502, details);
  }
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = (req as Request & { requestId?: string }).requestId;
  if (err instanceof AppError) {
    logger.warn({ requestId, code: err.code, status: err.status, details: err.details }, err.message);
    res.status(err.status).json({
      ok: false,
      code: err.code,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }
  logger.error({ requestId, err: err instanceof Error ? { msg: err.message, stack: err.stack } : err }, "unhandled error");
  res.status(500).json({ ok: false, code: "INTERNAL_ERROR", message: "internal error" });
}

/**
 * Express Request 글로벌 타입 augmentation.
 * @types/express 의 Express 네임스페이스를 확장.
 */
import "express";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string;
        role?: string;
        raw: import("jose").JWTPayload;
      };
      requestId?: string;
      rawBody?: string;
    }
  }
}

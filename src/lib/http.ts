import type { Request, Response, NextFunction, RequestHandler } from "express";

/** An error whose message is safe to show to API clients. */
export class HttpError extends Error {
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg: string, details?: Record<string, unknown>) => new HttpError(400, msg, details);
export const unauthorized = (msg = "Authentication required.") => new HttpError(401, msg);
export const forbidden = (msg = "Forbidden.", details?: Record<string, unknown>) => new HttpError(403, msg, details);
export const notFound = (msg = "Resource not found.") => new HttpError(404, msg);
export const conflict = (msg: string) => new HttpError(409, msg);

/** Wraps an async controller so rejections reach the global error handler. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** Postgres unique-violation detection (SQLSTATE 23505), searching nested causes. */
export const isUniqueViolation = (err: unknown, constraintHint?: string): boolean => {
  let current: any = err;
  for (let depth = 0; current && depth < 5; depth++) {
    if (current.code === "23505") {
      if (!constraintHint) return true;
      const text = `${current.constraint ?? ""} ${current.detail ?? ""} ${current.message ?? ""}`;
      return text.includes(constraintHint);
    }
    current = current.cause;
  }
  return false;
};

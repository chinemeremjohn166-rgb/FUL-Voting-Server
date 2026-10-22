import type { Request, Response, NextFunction } from "express";
import { HttpError, isUniqueViolation } from "../lib/http.ts";
import { config } from "../config.ts";

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    message: `Route not found: ${req.method} ${req.path}`,
  });
};

/**
 * Single place that turns errors into responses.
 * - HttpError: message is client-safe and returned as-is.
 * - express.json() parse/size errors: 400/413 with a generic message.
 * - Unique violations that escaped a controller: 409.
 * - Anything else: 500 with a generic message. Internal details (SQL, stack)
 *   are logged server-side and never sent to the client.
 */
export const globalErrorHandler = (
  err: any,
  _req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Something already wrote to this response, so there is nothing left to send.
  // Handing it back to Express lets the connection close instead of hanging.
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ message: err.message, ...(err.details && { details: err.details }) });
    return;
  }

  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ message: "Malformed JSON in request body." });
    return;
  }
  if (err?.type === "entity.too.large") {
    res.status(413).json({ message: "Request body too large." });
    return;
  }

  if (isUniqueViolation(err)) {
    res.status(409).json({ message: "A record with these values already exists." });
    return;
  }

  if (!config.isTest) console.error("Unhandled Error:", err);
  res.status(500).json({ message: "An unexpected error occurred." });
};

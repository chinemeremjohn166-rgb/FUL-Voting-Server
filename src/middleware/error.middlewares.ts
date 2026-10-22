import type { Request, Response, NextFunction } from "express";

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    message: `Route not found: \${req.method} \${req.originalUrl}`,
  });
};

export const globalErrorHandler = (
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  console.error("Unhandled Error:", err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    message: err.message || "An unexpected error occurred.",
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
};

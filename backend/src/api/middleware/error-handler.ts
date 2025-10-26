import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

type HttpError = Error & { status?: number; details?: unknown };

// Centralized error handler returning normalized payloads
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: HttpError, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Payload validation failed',
      details: err.flatten()
    });
  }

  const status = err.status ?? 500;
  const message = status >= 500 ? 'Internal server error' : err.message;

  if (status >= 500) {
    req.log.error({ err }, 'Unhandled application error');
  } else {
    req.log.warn({ err }, 'Handled application error');
  }

  return res.status(status).json({
    error: err.name || 'Error',
    message,
    details: err.details
  });
}

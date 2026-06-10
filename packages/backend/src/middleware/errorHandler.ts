import type { ErrorRequestHandler } from 'express';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (res.headersSent) {
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }
  console.error('[oxypay] unhandled error:', err);
  res.status(500).json({
    success: false,
    error: { code: 'internal_error', message: 'Internal server error' },
  });
};

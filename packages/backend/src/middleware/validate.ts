import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';
import { HttpError } from './errorHandler';

type Target = 'body' | 'query' | 'params';

export const validate =
  (schema: ZodSchema, target: Target = 'body') =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      next(new HttpError(400, 'invalid_request', 'Invalid request', result.error.flatten()));
      return;
    }
    (req as unknown as Record<Target, unknown>)[target] = result.data;
    next();
  };

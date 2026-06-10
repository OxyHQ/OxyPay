import type { Request, Response, NextFunction } from 'express';
import { oxyClient } from '@oxyhq/core';

/**
 * `oxyClient.auth()` verifies user JWTs minted by the Oxy API. On success it
 * attaches `req.user` with the resolved Oxy user. We re-export the underlying
 * middleware so route files can mount it directly.
 */
export const authMiddleware = oxyClient.auth();

/**
 * Service-token-only middleware (rejects user JWTs). Use for endpoints that
 * are only callable by internal Oxy services (e.g. webhooks delivery, billing).
 */
export const serviceAuthMiddleware = oxyClient.serviceAuth();

/**
 * Shape of the request after `authMiddleware`. Re-export here so route files
 * can type the request without each redefining their own `AuthRequest`.
 */
export interface AuthRequest extends Request {
  user?: {
    id: string;
    _id?: string;
    username?: string;
    email?: string;
    [key: string]: unknown;
  };
}

/** Returns the `userId` for an authenticated request, or 401s. */
export function requireUserId(req: AuthRequest, res: Response, next: NextFunction): void {
  const userId = req.user?.id ?? req.user?._id;
  if (!userId) {
    res.status(401).json({ success: false, error: { code: 'unauthorized', message: 'Missing user' } });
    return;
  }
  next();
}

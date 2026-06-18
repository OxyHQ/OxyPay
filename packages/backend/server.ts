import 'dotenv/config';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import http from 'http';
import rateLimit from 'express-rate-limit';

import { connectToDatabase } from './src/utils/database';
import { errorHandler } from './src/middleware/errorHandler';
import { authMiddleware, type AuthRequest } from './src/middleware/auth';

import walletsRouter from './src/routes/wallets';
import transactionsRouter from './src/routes/transactions';
import invoicesRouter from './src/routes/invoices';
import paymentsRouter from './src/routes/payments';
import faircoinRouter from './src/routes/faircoin';

const app = express();
const PORT = Number.parseInt(process.env.PORT || '3001', 10);

// Behind the AWS ALB, trust the first proxy hop so `req.ip` reflects the real
// client IP (used as the rate-limit key for anonymous traffic).
app.set('trust proxy', 1);

/**
 * Per-window rate-limit budgets (window = 1 minute, see limiter below).
 *
 * OxyPay is a PAYMENTS backend, so limits stay conservative. The previous
 * global limiter keyed by IP only, so behind the shared-egress ALB every user
 * drew from a single 300/min bucket — unrelated users could 429 each other.
 *
 * The fix is to resolve the user BEFORE the limiter and key PER USER, so each
 * authenticated user gets their own budget instead of sharing one IP bucket.
 * We deliberately do NOT loosen per-user volume on sensitive payment/transaction
 * mutation endpoints: the authenticated budget is kept at the existing 300/min,
 * and anonymous traffic is given a tighter bucket. Per-route strict guards
 * (validation, auth, balance checks) remain the real protection for mutations.
 */
const AUTHENTICATED_RATE_LIMIT_MAX = 300; // unchanged per-user budget (conservative)
const UNAUTHENTICATED_RATE_LIMIT_MAX = 60; // tighter bucket for anonymous IPs

/**
 * Resolve the user from the bearer token WITHOUT rejecting unauthenticated
 * requests. Idempotent: if a router's strict `authMiddleware` already resolved
 * the user, the costly token re-verification is skipped.
 *
 * Runs BEFORE the global rate limiter so the limiter keys per user instead of
 * per shared egress IP behind the ALB.
 */
const optionalAuth = (req: Request, res: Response, next: NextFunction): void => {
  if ((req as AuthRequest).user?.id || (req as AuthRequest).user?._id) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    next();
    return;
  }

  authMiddleware(req, res, (err?: unknown) => {
    // Optional auth: a failed/expired token must not block the request here.
    // Clear any partial user so it proceeds as anonymous; strict per-router
    // `authMiddleware` will still reject it on protected routes.
    if (err) {
      (req as AuthRequest).user = undefined;
    }
    next();
  });
};

/**
 * Paths exempt from the global rate limiter. OxyPay has no media fan-out, but
 * liveness probes must never be limited, and we defensively exempt any future
 * image/file endpoints so per-screen asset fan-out can't exhaust the bucket.
 */
const isRateLimitExempt = (req: Request): boolean => {
  const path = req.path;
  return (
    path === '/health' ||
    path.startsWith('/images/') ||
    path.includes('/images/') ||
    path.startsWith('/files/upload')
  );
};

/**
 * Per-user (authenticated) or per-IP (anonymous) rate-limit key. Keying by user
 * id is what stops unrelated users from sharing one IP bucket behind the ALB.
 */
const rateLimitKey = (req: Request): string => {
  const user = (req as AuthRequest).user;
  const userId = user?.id ?? user?._id;
  if (userId) {
    return `user:${userId}`;
  }
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
};

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:8081,http://localhost:8082')
  .split(',')
  .map((s) => s.trim());

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) return cb(null, true);
      cb(new Error(`Origin not allowed: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// DB connect on demand. Returning 503 keeps the API observable when Mongo is
// down without crashing the process.
app.use(async (_req, res, next) => {
  try {
    await connectToDatabase();
    next();
  } catch (err) {
    console.error('[oxypay] mongo unavailable:', err);
    if (!res.headersSent) {
      res.status(503).json({
        success: false,
        error: { code: 'database_unavailable', message: 'Database temporarily unavailable' },
      });
    }
  }
});

// Resolve the user BEFORE rate limiting so the limiter keys per authenticated
// user rather than per shared egress IP behind the ALB. Strict per-router
// `authMiddleware` still guards every protected route below.
app.use(optionalAuth);

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    // Conservative, per-user budget for payments: authenticated users keep the
    // existing 300/min (now their OWN bucket, not a shared IP bucket), while
    // anonymous traffic gets a tighter 60/min. Payment mutation endpoints are
    // NOT loosened beyond this.
    limit: (req: Request): number =>
      (req as AuthRequest).user?.id || (req as AuthRequest).user?._id
        ? AUTHENTICATED_RATE_LIMIT_MAX
        : UNAUTHENTICATED_RATE_LIMIT_MAX,
    keyGenerator: rateLimitKey,
    skip: isRateLimitExempt,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  })
);

app.get('/', (_req, res) => {
  res.json({ name: 'oxypay-backend', version: process.env.npm_package_version ?? '0.1.0', status: 'ok' });
});

app.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', uptime: process.uptime() } });
});

app.use('/wallets', walletsRouter);
app.use('/transactions', transactionsRouter);
app.use('/invoices', invoicesRouter);
app.use('/payments', paymentsRouter);
app.use('/faircoin', faircoinRouter);

app.use(errorHandler);

const server = http.createServer(app);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`[oxypay] backend listening on http://localhost:${PORT}`);
  });
}

export default app;

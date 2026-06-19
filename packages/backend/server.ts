import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { oxyClient } from '@oxyhq/core';
import { createOxyRateLimit } from '@oxyhq/core/server';

import { connectToDatabase } from './src/utils/database';
import { errorHandler } from './src/middleware/errorHandler';

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

const AUTHENTICATED_RATE_LIMIT_MAX = 300; // unchanged per-user budget (conservative)
const UNAUTHENTICATED_RATE_LIMIT_MAX = 60; // tighter bucket for anonymous IPs

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
// `requireOxyAuth` still guards every protected route below.
app.use(createOxyRateLimit(oxyClient, {
  windowMs: 60 * 1000,
  authenticatedMax: AUTHENTICATED_RATE_LIMIT_MAX,
  anonymousMax: UNAUTHENTICATED_RATE_LIMIT_MAX,
}));

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
  server.listen(PORT);
}

export default app;

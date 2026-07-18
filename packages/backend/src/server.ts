/**
 * Oxy Pay Gateway — backend entry point.
 *
 * Non-custodial by construction: this server never holds private keys or funds.
 * It orchestrates the PaymentIntent lifecycle — REST commands, realtime state
 * over Socket.io, a tip-driven settlement watcher, and signed webhooks — while
 * the payer's self-custody wallet signs and broadcasts the on-chain transaction.
 */
import { createServer, type Server as HttpServer } from "node:http";
import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from "express";
import { Server as SocketServer } from "socket.io";
import { oxyClient } from "@oxyhq/core";
import { createOxyCors, createOxyRateLimit } from "@oxyhq/core/server";
import type {
  PaymentIntentStatus,
  WebhookEventType,
} from "@oxypay/shared-types";
import { config } from "./config";
import { connectDb } from "./db";
import { Merchant } from "./models/Merchant";
import { WebhookDelivery } from "./models/WebhookDelivery";
import { createPaymentIntentsRouter } from "./routes/paymentIntents";
import { createMerchantsRouter } from "./routes/merchants";
import {
  SettlementWatcher,
  type HydratedPaymentIntentDoc,
} from "./services/settlementWatcher";
import { getTransaction } from "./services/explorer";
import {
  buildEvent,
  deliver,
  type SafeFetchFn,
} from "./services/webhookDispatcher";
import {
  initSocket,
  emitIntentUpdate,
  type SocketAuth,
} from "./realtime/socket";
import { toPaymentIntentDTO } from "./lib/serialize";

/** Date-based API version, echoed on every response (Stripe-parity). */
const OXY_PAY_VERSION = "2026-07-18";

/** Which statuses emit a webhook, and the Stripe-parity event type for each. */
const WEBHOOK_EVENT_FOR: Partial<
  Record<PaymentIntentStatus, WebhookEventType>
> = {
  confirming: "payment_intent.confirming",
  settled: "payment_intent.settled",
  failed: "payment_intent.failed",
  rejected: "payment_intent.rejected",
  expired: "payment_intent.expired",
};

export interface GatewayDeps {
  /**
   * Merchant service-auth middleware (default
   * `oxyClient.serviceAuth({ jwtSecret: config.serviceJwtSecret })`).
   */
  requireMerchant?: RequestHandler;
  /** Optional service-auth middleware for the dual-auth payer/merchant GET route. */
  optionalServiceAuth?: RequestHandler;
  /** Socket connection auth (default `oxyClient.authSocket()`). */
  socketAuth?: SocketAuth;
  /** On-chain reader (default the real Explorer client). */
  getTransaction?: typeof getTransaction;
  /** SSRF-safe fetch used for webhook delivery (default the real one). */
  safeFetch?: SafeFetchFn;
}

export interface Gateway {
  httpServer: HttpServer;
  io: SocketServer;
  watcher: SettlementWatcher;
}

/**
 * When the watcher advances an intent, fan the change out to both transports:
 * the payer's realtime socket room AND the merchant's signed webhook. Webhook
 * delivery is best-effort (never throws) so it cannot stall the watcher.
 * Exported for direct testing (`__tests__/onIntentChange.test.ts`).
 */
export async function onIntentChange(
  io: SocketServer,
  intent: HydratedPaymentIntentDoc,
  safeFetch: SafeFetchFn | undefined,
): Promise<void> {
  emitIntentUpdate(io, intent);

  const eventType = WEBHOOK_EVENT_FOR[intent.status];
  if (eventType === undefined) return;

  const merchant = await Merchant.findById(intent.merchantId);
  if (!merchant || !merchant.webhookUrl || !merchant.webhookSecret) return;

  const event = buildEvent(eventType, toPaymentIntentDTO(intent));
  const outcome = await deliver(
    event,
    { url: merchant.webhookUrl, secret: merchant.webhookSecret },
    safeFetch ? { safeFetch } : {},
  );

  // Persisting the delivery log is best-effort, same as `deliver()` itself —
  // a transient Mongo write failure here must never abort the settlement
  // watcher's poll loop (`SettlementWatcher.check()` awaits `onChange` inline
  // per intent, with no per-iteration try/catch of its own — see
  // `settlementWatcher.ts:79-88`).
  try {
    await WebhookDelivery.create({
      merchantId: merchant.id,
      intentId: intent.id,
      eventId: event.id,
      eventType,
      url: merchant.webhookUrl,
      attempts: outcome.attempts,
      delivered: outcome.delivered,
      lastStatus: outcome.delivered ? "delivered" : "failed",
    });
  } catch (error) {
    process.emitWarning(
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

/**
 * Assemble the gateway (Express app + HTTP server + Socket.io + watcher) WITHOUT
 * starting it. Dependencies are injectable so integration tests can stub auth,
 * the on-chain reader, and webhook delivery, and drive `watcher.check()` by hand.
 */
export function createGateway(deps: GatewayDeps = {}): Gateway {
  const app = express();

  // Unauthenticated liveness probe for the ALB target-group health check.
  // Mounted first so it is never CORS-blocked or rate-limited, and returns 200
  // regardless of auth (every other route is auth-gated). It reveals nothing.
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use(createOxyCors());
  app.use(createOxyRateLimit(oxyClient));
  app.use(express.json());
  app.use(((_req, res, next) => {
    res.setHeader("Oxy-Pay-Version", OXY_PAY_VERSION);
    next();
  }) as RequestHandler);
  const requireMerchant: RequestHandler =
    deps.requireMerchant ??
    oxyClient.serviceAuth({ jwtSecret: config.serviceJwtSecret });
  const optionalServiceAuth: RequestHandler =
    deps.optionalServiceAuth ??
    oxyClient.auth({ jwtSecret: config.serviceJwtSecret, optional: true });

  app.use(createPaymentIntentsRouter({ requireMerchant, optionalServiceAuth }));
  app.use(createMerchantsRouter({ requireMerchant }));

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    const message = err instanceof Error ? err.message : "internal error";
    res.status(500).json({ error: { type: "api_error", message } });
  };
  app.use(errorHandler);

  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, {
    // No reflected origins and no credentials (auth is a token in the handshake,
    // not a cookie), so a cross-site page cannot hijack a socket. A browser
    // origin must be explicitly allowlisted; non-browser clients send no Origin.
    cors: {
      origin(origin, callback): void {
        if (origin === undefined || config.allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      credentials: false,
    },
  });
  initSocket(io, { socketAuth: deps.socketAuth });

  const watcher = new SettlementWatcher({
    getTransaction: deps.getTransaction ?? getTransaction,
    onChange: (intent) => onIntentChange(io, intent, deps.safeFetch),
  });

  return { httpServer, io, watcher };
}

/** Production entry: connect the DB, boot the watcher, and listen. */
export async function start(): Promise<void> {
  await connectDb();
  const gateway = createGateway();
  gateway.watcher.start();
  gateway.httpServer.listen(config.port);
}

if (import.meta.main) {
  start().catch((error: unknown) => {
    process.emitWarning(
      error instanceof Error ? error : new Error(String(error)),
    );
    process.exitCode = 1;
  });
}

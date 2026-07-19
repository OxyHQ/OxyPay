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
import { createWebhookDeliveriesRouter } from "./routes/webhookDeliveries";
import { createPaymentLinksRouter } from "./routes/paymentLinks";
import { createCheckoutSessionsRouter } from "./routes/checkoutSessions";
import { createSocialRouter } from "./routes/social";
import { createEnrichRouter } from "./routes/enrich";
import { createDashboardRouter } from "./routes/dashboard";
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

/**
 * Flat per-window cap for the IDENTITY-AGNOSTIC public payer routes
 * (payment-link/checkout-session public display + public intent mint) —
 * deliberately tighter than the global limiter's `anonymousMax` default
 * (600/15min): the mint route derives a fresh watch-only address per call, so
 * an unthrottled caller could churn `Merchant.nextDerivationIndex`
 * (address-space DoS). Applied to BOTH `anonymousMax` and `authenticatedMax`
 * below — these routes grant no elevated capability to a signed-in Oxy
 * identity or a service token belonging to some OTHER app, so neither may
 * get a higher budget than a fully anonymous caller.
 */
const PUBLIC_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const PUBLIC_RATE_LIMIT_MAX = 30;

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
  /**
   * Rate limiter for the UNAUTHENTICATED payment-link/checkout-session payer
   * routes (default a dedicated `createOxyRateLimit` instance — see
   * `PUBLIC_RATE_LIMIT_*` above — separate from the global limiter mounted
   * below so its tighter anonymous budget applies ONLY to those four routes).
   */
  publicRateLimit?: RequestHandler;
  /** End-user Oxy auth for the social + enrich + dashboard routes (default `createOxyAuthMiddleware(oxyClient)`). */
  requireOxyUser?: RequestHandler;
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

  // `appOrigins`: `createOxyCors`'s built-in Oxy-family allowlist only trusts
  // ONE-LABEL `*.oxy.so` subdomains, so a two-label host like the F2.5
  // dashboard (`dashboard.pay.oxy.so`) must be listed explicitly via
  // `config.allowedOrigins` (`OXY_PAY_ALLOWED_ORIGINS`) — the SAME list the
  // Socket.io `cors.origin` check below already reads.
  app.use(createOxyCors({ appOrigins: config.allowedOrigins }));
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
  const publicRateLimit: RequestHandler =
    deps.publicRateLimit ??
    createOxyRateLimit(oxyClient, {
      anonymousMax: PUBLIC_RATE_LIMIT_MAX,
      // `createOxyRateLimit` resolves `oxy.auth({ optional: true })` BEFORE
      // limiting regardless of route auth, so ANY caller with a valid Oxy
      // session or service token — not just a merchant of THIS gateway —
      // would otherwise get the 5000/window authenticated default on these
      // identity-agnostic public routes. Pin it to the same cap so having
      // an unrelated Oxy account can't buy 167x the intended budget for the
      // exact abuse (`nextDerivationIndex` churn) this limiter exists to bound.
      authenticatedMax: PUBLIC_RATE_LIMIT_MAX,
      windowMs: PUBLIC_RATE_LIMIT_WINDOW_MS,
    });

  app.use(createPaymentIntentsRouter({ requireMerchant, optionalServiceAuth }));
  app.use(createSocialRouter({ requireOxyUser: deps.requireOxyUser }));
  app.use(createEnrichRouter({ requireOxyUser: deps.requireOxyUser }));
  app.use(createMerchantsRouter({ requireMerchant }));
  app.use(
    createWebhookDeliveriesRouter({ requireMerchant, safeFetch: deps.safeFetch }),
  );
  app.use(createPaymentLinksRouter({ requireMerchant, publicRateLimit }));
  app.use(createCheckoutSessionsRouter({ requireMerchant, publicRateLimit }));
  app.use(
    createDashboardRouter({ requireOxyUser: deps.requireOxyUser, safeFetch: deps.safeFetch }),
  );

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

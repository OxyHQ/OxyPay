import { Router } from "express";
import type {
  Request,
  RequestHandler,
  Response,
} from "express";
import { z } from "zod";
import { oxyClient } from "@oxyhq/core";
import { verifySecret } from "@oxyhq/core/server";
import type { OxyAuthRequest, OxyServiceEnvironment } from "@oxyhq/core/server";
import {
  isBaseUnitString,
  PAYMENT_INTENT_STATUSES,
  type CreatePaymentIntentParams,
  type PaymentIntentStatus,
} from "@peable.to/shared-types";
import { getDb } from "../db/postgres";
import { findMerchantByAppEnvironment } from "../db/merchants/merchantRepository";
import type { MerchantRow } from "../db/merchants/merchantRepository";
import {
  findIntentByPublicId,
  findIntentForMerchant,
  listIntentsForMerchant,
  updateIntentState,
} from "../db/payments/paymentIntentRepository";
import type { PaymentIntentRow } from "../db/payments/paymentIntentRepository";
import { createIntent, NetworkMismatchError } from "../services/createIntent";
import { applyEvent } from "../services/intentState";
import { toPaymentIntentDTO } from "../lib/serialize";
import { sendError, wrap, requireServiceApp, requireAuthenticated } from "../lib/http";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

/** Exported: `routes/dashboard.ts` parses the SAME query shape for its list route (F2.5) so the two never drift. */
export const listQuerySchema = z.object({
  status: z
    .enum(PAYMENT_INTENT_STATUSES as [PaymentIntentStatus, ...PaymentIntentStatus[]])
    .optional(),
  limit: z.coerce.number().int().positive().max(MAX_LIST_LIMIT).optional(),
  starting_after: z.string().optional(),
});

// Zod schema for the create body. Its inferred output is asserted assignable to
// `CreatePaymentIntentParams` (see `params` below) so the wire contract and the
// shared type can never silently drift apart.
const createBodySchema = z.object({
  amount: z
    .string()
    .refine(isBaseUnitString, "amount must be a base-unit integer string"),
  network: z.enum(["mainnet", "testnet"]),
  metadata: z.record(z.string(), z.string()).optional(),
  expiresInSeconds: z.number().int().positive().optional(),
});

// The payer proves possession of the intent with its `client_secret`; the
// reported broadcast txid is what the settlement watcher then verifies on-chain.
const submitTxBodySchema = z.object({
  client_secret: z.string().min(1),
  txid: z.string().min(1),
});

/**
 * Single query owner for "find a Merchant by (oxyAppId, environment)" — no
 * side effects, no response writes. Shared by `resolveMerchant` (service-auth
 * path, below) and `resolveMerchantByApp` (dashboard path, F2.5) so there is
 * exactly one place that knows the compound key `Merchant` is looked up by.
 */
function findMerchantByAppEnv(
  oxyAppId: string,
  environment: OxyServiceEnvironment,
): Promise<MerchantRow | null> {
  return findMerchantByAppEnvironment(getDb(), oxyAppId, environment);
}

/**
 * Resolve the merchant behind the authenticated service app, scoped to BOTH
 * the caller's Application AND its credential's `environment` (F2.0 task 1b —
 * test/live isolation). Returns null AND writes the error response when the
 * caller is unauthenticated (401) or the app has no merchant registered for
 * this specific environment (403), so callers just `if (!merchant) return`.
 *
 * Exported: `routes/merchants.ts` reuses this unchanged for the merchant-authed
 * GET/PATCH `/v1/merchants/me` routes.
 */
export async function resolveMerchant(
  req: Request,
  res: Response,
): Promise<MerchantRow | null> {
  const serviceApp = requireServiceApp(req, res);
  if (!serviceApp) return null;
  const merchant = await findMerchantByAppEnv(serviceApp.appId, serviceApp.environment);
  if (!merchant) {
    sendError(res, 403, "permission_error", "no merchant registered for this app");
    return null;
  }
  return merchant;
}

/**
 * Dashboard-path sibling of `resolveMerchant` (F2.5): resolves a Merchant by
 * an EXPLICIT `(applicationId, environment)` pair instead of `req.serviceApp`,
 * since a `/v1/dashboard/*` caller is a human Oxy user, not a service-authed
 * merchant — the application + environment come from the route param + query
 * (already validated + membership-checked by `routes/dashboard.ts` before this
 * is called). 404 (not 403): the caller's ACCESS to the application was
 * already proven by `assertAppMembership`, so a missing merchant here means
 * exactly what it says — nothing registered for this environment yet, not a
 * permission gap.
 */
export async function resolveMerchantByApp(
  applicationId: string,
  environment: OxyServiceEnvironment,
  res: Response,
): Promise<MerchantRow | null> {
  const merchant = await findMerchantByAppEnv(applicationId, environment);
  if (!merchant) {
    sendError(
      res,
      404,
      "invalid_request_error",
      "no merchant registered for this application in this environment",
    );
    return null;
  }
  return merchant;
}

export interface ListPaymentIntentsQuery {
  status?: PaymentIntentStatus;
  limit?: number;
  starting_after?: string;
}

export type ListPaymentIntentsResult =
  | { ok: true; data: PaymentIntentRow[]; hasMore: boolean }
  | { ok: false; status: number; message: string };

/**
 * Shared pagination body for "list a merchant's payment intents" — factored
 * out (F2.5) so `GET /v1/payment_intents` (below) and the dashboard's `GET
 * /v1/dashboard/applications/:applicationId/payment_intents` run the EXACT
 * same query/cursor/status-filter logic against different auth paths, never
 * two copies to keep in sync.
 */
export async function listPaymentIntentsForMerchant(
  merchantId: string,
  query: ListPaymentIntentsQuery,
): Promise<ListPaymentIntentsResult> {
  const { status, starting_after } = query;
  const limit = query.limit ?? DEFAULT_LIST_LIMIT;
  const db = getDb();

  // The cursor arrives as a PUBLIC `pi_…` and the keyset walk runs on the
  // primary key, so it is resolved here — ownership-scoped, so a cursor
  // naming another merchant's intent is a 422 exactly like an unknown one and
  // never confirms that the intent exists.
  let after: string | undefined;
  if (starting_after) {
    const cursor = await findIntentForMerchant(db, starting_after, merchantId);
    if (!cursor) {
      return {
        ok: false,
        status: 422,
        message: "starting_after references an unknown payment intent",
      };
    }
    after = cursor.id;
  }

  const page = await listIntentsForMerchant(db, { merchantId, status, limit, after });
  return { ok: true, data: page.data, hasMore: page.hasMore };
}

/**
 * Build the payment-intent REST router.
 *
 * `requireMerchant` and `optionalServiceAuth` are injectable so tests can
 * bypass real Oxy service tokens with stubs that populate `req.serviceApp`;
 * in production callers must pass `oxyClient.serviceAuth({ jwtSecret })` /
 * `oxyClient.auth({ jwtSecret, optional: true })` explicitly (see
 * `server.ts`) — there is no bare default here, since those with no
 * `jwtSecret` reject (or silently drop) every real token. `requireMerchant`
 * gates the merchant-only routes; `optionalServiceAuth` gates the dual-auth
 * `GET /:id` route. `submit_tx` is the payer path and is guarded by the
 * intent's `client_secret` instead.
 */
export function createPaymentIntentsRouter(deps: {
  requireMerchant: RequestHandler;
  optionalServiceAuth: RequestHandler;
  /**
   * Fan a state change out to the payer's socket room and the merchant's
   * webhook. Injected rather than imported because `server.ts` owns the
   * Socket.io instance; the routes must not reach for a module-level one.
   *
   * Optional so a suite exercising only request/response shape need not stand
   * one up — but production ALWAYS passes it. Without it, `submit_tx` and
   * `reject` change status and tell nobody: the payer's checkout page stays on
   * its initial snapshot, and `payment_intent.rejected` — whose only writer is
   * the reject route — can never fire.
   */
  notifyIntentChange?: (intent: PaymentIntentRow) => Promise<void>;
}): Router {
  const { requireMerchant, optionalServiceAuth } = deps;
  const router = Router();

  /**
   * Best-effort fanout. A broken socket or an unreachable webhook endpoint must
   * never turn an already-committed transition into a 5xx: the payer would be
   * told their broadcast failed when the gateway has in fact recorded it, and
   * the row would still be advanced. Awaited rather than fired-and-forgotten so
   * the delivery log is written before the response, matching how
   * `SettlementWatcher` awaits `onChange` inline.
   */
  async function notify(intent: PaymentIntentRow): Promise<void> {
    if (!deps.notifyIntentChange) return;
    try {
      await deps.notifyIntentChange(intent);
    } catch (error) {
      process.emitWarning(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  router.post(
    "/v1/payment_intents",
    requireMerchant,
    requireAuthenticated,
    oxyClient.requireScope("payments:write"),
    wrap(async (req, res) => {
      const merchant = await resolveMerchant(req, res);
      if (!merchant) return;

      const idempotencyKey = req.header("Idempotency-Key")?.trim();
      if (!idempotencyKey) {
        sendError(
          res,
          400,
          "invalid_request_error",
          "Idempotency-Key header is required",
        );
        return;
      }

      const parsed = createBodySchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(
          res,
          422,
          "invalid_request_error",
          parsed.error.issues[0]?.message ?? "invalid request body",
        );
        return;
      }
      const params: CreatePaymentIntentParams = parsed.data;

      try {
        const { intent, reused } = await createIntent({
          merchant,
          amount: params.amount,
          network: params.network,
          metadata: params.metadata,
          expiresInSeconds: params.expiresInSeconds,
          idempotencyKey,
        });
        res
          .status(reused ? 200 : 201)
          .json({ ...toPaymentIntentDTO(intent), client_secret: intent.clientSecret });
      } catch (err) {
        // Data-integrity firewall (F2.0 task 1a): the watch-only address is
        // derived using the MERCHANT's network (`reserveAddress.ts`), never
        // the caller's claimed `network` — `createIntent` rejects a mismatch
        // up front, or the returned intent's `network` label would lie about
        // the network its `address` actually encodes.
        if (err instanceof NetworkMismatchError) {
          sendError(res, 422, "invalid_request_error", err.message);
          return;
        }
        throw err;
      }
    }),
  );

  router.get(
    "/v1/payment_intents",
    requireMerchant,
    requireAuthenticated,
    oxyClient.requireScope("payments:read"),
    wrap(async (req, res) => {
      const merchant = await resolveMerchant(req, res);
      if (!merchant) return;

      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        sendError(
          res,
          422,
          "invalid_request_error",
          parsed.error.issues[0]?.message ?? "invalid query",
        );
        return;
      }

      const result = await listPaymentIntentsForMerchant(merchant.id, parsed.data);
      if (!result.ok) {
        sendError(res, result.status, "invalid_request_error", result.message);
        return;
      }
      const data = result.data.map((intent) => toPaymentIntentDTO(intent));
      res.status(200).json({ object: "list", data, has_more: result.hasMore });
    }),
  );

  router.get(
    "/v1/payment_intents/:id",
    optionalServiceAuth,
    wrap(async (req, res) => {
      const { serviceApp } = req as OxyAuthRequest;

      // `noUncheckedIndexedAccess` types `req.params.id` as possibly
      // `undefined` even though Express guarantees `:id` is present here.
      // Read once, above the branch, because BOTH the merchant path and the
      // payer path below need it.
      const { id } = req.params;
      if (!id) {
        sendError(res, 422, "invalid_request_error", "id is required");
        return;
      }

      if (serviceApp?.appId) {
        // Merchant path — same `payments:read` requirement as the list route
        // (F2.0 gateway-review finding: this branch previously enforced no
        // scope at all). Can't use `oxyClient.requireScope()` as ordinary
        // route middleware here — that would also gate the payer/client_secret
        // branch below, which has no service token to check — so the SAME
        // scope-checking primitive is invoked manually, scoped to just this
        // branch.
        let scopeGranted = false;
        oxyClient.requireScope("payments:read")(req, res, () => {
          scopeGranted = true;
        });
        if (!scopeGranted) return;

        const merchant = await resolveMerchant(req, res);
        if (!merchant) return;
        const intent = await findIntentForMerchant(getDb(), id, merchant.id);
        if (!intent) {
          sendError(res, 404, "invalid_request_error", "payment intent not found");
          return;
        }
        res.status(200).json(toPaymentIntentDTO(intent));
        return;
      }

      // Payer path — authorized by possession of the intent's `client_secret`,
      // the same idiom `submit_tx` and the socket `subscribe` already use.
      // Needed for a hosted checkout page's initial REST snapshot before its
      // socket subscription confirms (F2.0 task 3).
      const clientSecretParam = req.query.client_secret;
      const clientSecret =
        typeof clientSecretParam === "string"
          ? clientSecretParam
          : req.header("X-Peable-Client-Secret");
      if (!clientSecret) {
        sendError(
          res,
          401,
          "authentication_error",
          "missing service app credentials or client_secret",
        );
        return;
      }

      const intent = await findIntentByPublicId(getDb(), id);
      if (!intent) {
        sendError(res, 404, "invalid_request_error", "payment intent not found");
        return;
      }
      if (!verifySecret(clientSecret, intent.clientSecret)) {
        sendError(res, 403, "permission_error", "invalid client_secret");
        return;
      }
      res.status(200).json(toPaymentIntentDTO(intent));
    }),
  );

  router.post(
    "/v1/payment_intents/:id/reject",
    requireMerchant,
    requireAuthenticated,
    oxyClient.requireScope("payments:write"),
    wrap(async (req, res) => {
      const merchant = await resolveMerchant(req, res);
      if (!merchant) return;

      // `noUncheckedIndexedAccess` types `req.params.id` as possibly
      // `undefined` even though Express guarantees `:id` is present here. The
      // repositories take a `string`, so the guard is explicit rather than a
      // non-null assertion.
      const { id } = req.params;
      if (!id) {
        sendError(res, 422, "invalid_request_error", "id is required");
        return;
      }

      const intent = await findIntentForMerchant(getDb(), id, merchant.id);
      if (!intent) {
        sendError(res, 404, "invalid_request_error", "payment intent not found");
        return;
      }

      let nextStatus: PaymentIntentStatus;
      try {
        nextStatus = applyEvent(intent.status, "reject");
      } catch (err) {
        sendError(
          res,
          409,
          "invalid_request_error",
          err instanceof Error ? err.message : "illegal state transition",
        );
        return;
      }
      const rejected = await updateIntentState(getDb(), intent.id, { status: nextStatus });
      if (!rejected) {
        sendError(res, 404, "invalid_request_error", "payment intent not found");
        return;
      }
      await notify(rejected);
      res.status(200).json(toPaymentIntentDTO(rejected));
    }),
  );

  // Payer path — NOT merchant-authed. Possession of the intent's `client_secret`
  // is the authorization; the reported txid is handed to the settlement watcher.
  router.post(
    "/v1/payment_intents/:id/submit_tx",
    wrap(async (req, res) => {
      const parsed = submitTxBodySchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(
          res,
          422,
          "invalid_request_error",
          parsed.error.issues[0]?.message ?? "invalid request body",
        );
        return;
      }

      // `noUncheckedIndexedAccess` types `req.params.id` as possibly
      // `undefined` even though Express guarantees `:id` is present here. The
      // repositories take a `string`, so the guard is explicit rather than a
      // non-null assertion.
      const { id } = req.params;
      if (!id) {
        sendError(res, 422, "invalid_request_error", "id is required");
        return;
      }

      const intent = await findIntentByPublicId(getDb(), id);
      if (!intent) {
        sendError(res, 404, "invalid_request_error", "payment intent not found");
        return;
      }

      if (!verifySecret(parsed.data.client_secret, intent.clientSecret)) {
        sendError(res, 403, "permission_error", "invalid client_secret");
        return;
      }

      let nextStatus: PaymentIntentStatus;
      try {
        nextStatus = applyEvent(intent.status, "broadcast");
      } catch (err) {
        sendError(
          res,
          409,
          "invalid_request_error",
          err instanceof Error ? err.message : "illegal state transition",
        );
        return;
      }
      // Status and txid move in ONE statement: `payment_intents_broadcast_requires_txid_check`
      // refuses `broadcast` without the txid beside it, so two writes could not
      // satisfy the constraint in either order.
      const broadcast = await updateIntentState(getDb(), intent.id, {
        status: nextStatus,
        txid: parsed.data.txid,
      });
      if (!broadcast) {
        sendError(res, 404, "invalid_request_error", "payment intent not found");
        return;
      }
      await notify(broadcast);
      res.status(200).json(toPaymentIntentDTO(broadcast));
    }),
  );

  return router;
}

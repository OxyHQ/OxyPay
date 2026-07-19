import { Router } from "express";
import type {
  Request,
  RequestHandler,
  Response,
} from "express";
import type { FilterQuery, HydratedDocument } from "mongoose";
import { z } from "zod";
import { oxyClient } from "@oxyhq/core";
import { verifySecret } from "@oxyhq/core/server";
import type { OxyAuthRequest } from "@oxyhq/core/server";
import {
  isBaseUnitString,
  PAYMENT_INTENT_STATUSES,
  type CreatePaymentIntentParams,
  type PaymentIntentStatus,
} from "@oxypay/shared-types";
import { Merchant } from "../models/Merchant";
import type { MerchantDoc } from "../models/Merchant";
import { PaymentIntent } from "../models/PaymentIntent";
import type { PaymentIntentDoc } from "../models/PaymentIntent";
import { createIntent, NetworkMismatchError } from "../services/createIntent";
import { applyEvent } from "../services/intentState";
import { toPaymentIntentDTO } from "../lib/serialize";
import { sendError, wrap, requireServiceApp, requireAuthenticated } from "../lib/http";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

const listQuerySchema = z.object({
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
): Promise<HydratedDocument<MerchantDoc> | null> {
  const serviceApp = requireServiceApp(req, res);
  if (!serviceApp) return null;
  const merchant = await Merchant.findOne({
    oxyAppId: serviceApp.appId,
    environment: serviceApp.environment,
  });
  if (!merchant) {
    sendError(res, 403, "permission_error", "no merchant registered for this app");
    return null;
  }
  return merchant;
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
}): Router {
  const { requireMerchant, optionalServiceAuth } = deps;
  const router = Router();

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
      const { status, starting_after } = parsed.data;
      const limit = parsed.data.limit ?? DEFAULT_LIST_LIMIT;

      const filter: FilterQuery<PaymentIntentDoc> = { merchantId: merchant.id };
      if (status) filter.status = status;

      if (starting_after) {
        const cursor = await PaymentIntent.findOne({
          id: starting_after,
          merchantId: merchant.id,
        });
        if (!cursor) {
          sendError(
            res,
            422,
            "invalid_request_error",
            "starting_after references an unknown payment intent",
          );
          return;
        }
        filter._id = { $lt: cursor._id };
      }

      const page = await PaymentIntent.find(filter).sort({ _id: -1 }).limit(limit + 1);
      const hasMore = page.length > limit;
      const data = (hasMore ? page.slice(0, limit) : page).map((intent) =>
        toPaymentIntentDTO(intent),
      );

      res.status(200).json({ object: "list", data, has_more: hasMore });
    }),
  );

  router.get(
    "/v1/payment_intents/:id",
    optionalServiceAuth,
    wrap(async (req, res) => {
      const { serviceApp } = req as OxyAuthRequest;

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
        const intent = await PaymentIntent.findOne({
          id: req.params.id,
          merchantId: merchant.id,
        });
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
          : req.header("X-Oxy-Pay-Client-Secret");
      if (!clientSecret) {
        sendError(
          res,
          401,
          "authentication_error",
          "missing service app credentials or client_secret",
        );
        return;
      }

      const intent = await PaymentIntent.findOne({ id: req.params.id });
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

      const intent = await PaymentIntent.findOne({
        id: req.params.id,
        merchantId: merchant.id,
      });
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
      intent.status = nextStatus;
      await intent.save();
      res.status(200).json(toPaymentIntentDTO(intent));
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

      const intent = await PaymentIntent.findOne({ id: req.params.id });
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
      intent.txid = parsed.data.txid;
      intent.status = nextStatus;
      await intent.save();
      res.status(200).json(toPaymentIntentDTO(intent));
    }),
  );

  return router;
}

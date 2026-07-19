import { Router } from "express";
import type { RequestHandler } from "express";
import { z } from "zod";
import { oxyClient } from "@oxyhq/core";
import { verifySecret } from "@oxyhq/core/server";
import { isBaseUnitString, type CreateCheckoutSessionParams } from "@oxypay/shared-types";
import { Merchant } from "../models/Merchant";
import { PaymentIntent } from "../models/PaymentIntent";
import { CheckoutSession } from "../models/CheckoutSession";
import { createIntent, NetworkMismatchError } from "../services/createIntent";
import { resolveMerchantDisplay } from "../services/merchantDisplay";
import { newId } from "../lib/ids";
import { toCheckoutSessionDTO, toCheckoutSessionPublicDTO } from "../lib/serialize";
import { sendError, wrap, requireAuthenticated } from "../lib/http";
import { resolveMerchant } from "./paymentIntents";

const createBodySchema = z.object({
  amount: z
    .string()
    .refine(isBaseUnitString, "amount must be a base-unit integer string"),
  network: z.enum(["mainnet", "testnet"]),
  metadata: z.record(z.string(), z.string()).optional(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

/**
 * Build the checkout-session REST router (F2.2). `POST`/merchant `GET` follow
 * the same merchant-authed chain as `paymentIntents.ts`; the public `GET
 * .../public` is the checkout page's payer path, authorized by possession of
 * the wrapped intent's `client_secret` — exactly the same idiom as the payer
 * branch of `GET /v1/payment_intents/:id` — never a service token.
 */
export function createCheckoutSessionsRouter(deps: {
  requireMerchant: RequestHandler;
  publicRateLimit: RequestHandler;
}): Router {
  const { requireMerchant, publicRateLimit } = deps;
  const router = Router();

  router.post(
    "/v1/checkout_sessions",
    requireMerchant,
    requireAuthenticated,
    oxyClient.requireScope("payments:write"),
    wrap(async (req, res) => {
      const merchant = await resolveMerchant(req, res);
      if (!merchant) return;

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
      const params: CreateCheckoutSessionParams = parsed.data;

      try {
        // No `idempotencyKey`: a checkout session wraps exactly ONE intent
        // minted fresh at session-create time (Stripe Checkout Session
        // parity) — there is nothing to replay against.
        const { intent } = await createIntent({
          merchant,
          amount: params.amount,
          network: params.network,
          metadata: params.metadata,
        });

        // Explicit field whitelist — never spread `req.body`.
        const session = await CheckoutSession.create({
          publicId: newId("cs"),
          merchantId: merchant.id,
          oxyAppId: merchant.oxyAppId,
          environment: merchant.environment,
          paymentIntentId: intent.id,
          amount: params.amount,
          network: params.network,
          metadata: params.metadata
            ? new Map(Object.entries(params.metadata))
            : new Map<string, string>(),
          successUrl: params.successUrl,
          cancelUrl: params.cancelUrl,
        });

        res.status(201).json(toCheckoutSessionDTO(session, intent));
      } catch (err) {
        if (err instanceof NetworkMismatchError) {
          sendError(res, 422, "invalid_request_error", err.message);
          return;
        }
        throw err;
      }
    }),
  );

  router.get(
    "/v1/checkout_sessions/:id",
    requireMerchant,
    requireAuthenticated,
    oxyClient.requireScope("payments:read"),
    wrap(async (req, res) => {
      const merchant = await resolveMerchant(req, res);
      if (!merchant) return;

      const session = await CheckoutSession.findOne({
        publicId: req.params.id,
        merchantId: merchant.id,
      });
      if (!session) {
        sendError(res, 404, "invalid_request_error", "checkout session not found");
        return;
      }
      const intent = await PaymentIntent.findOne({ id: session.paymentIntentId });
      if (!intent) {
        sendError(res, 404, "invalid_request_error", "checkout session not found");
        return;
      }
      res.status(200).json(toCheckoutSessionDTO(session, intent));
    }),
  );

  // Public payer path — UNAUTHENTICATED, rate-limited, authorized by
  // possession of the wrapped intent's `client_secret` (query param or
  // `X-Oxy-Pay-Client-Secret` header — mirrors `GET /v1/payment_intents/:id`).
  // Never leaks `merchant`/`paymentIntent` without a proven secret.
  router.get(
    "/v1/checkout_sessions/:id/public",
    publicRateLimit,
    wrap(async (req, res) => {
      const session = await CheckoutSession.findOne({ publicId: req.params.id });
      if (!session) {
        sendError(res, 404, "invalid_request_error", "checkout session not found");
        return;
      }
      const intent = await PaymentIntent.findOne({ id: session.paymentIntentId });
      if (!intent) {
        sendError(res, 404, "invalid_request_error", "checkout session not found");
        return;
      }

      const clientSecretParam = req.query.client_secret;
      const clientSecret =
        typeof clientSecretParam === "string"
          ? clientSecretParam
          : req.header("X-Oxy-Pay-Client-Secret");
      if (!clientSecret) {
        sendError(res, 401, "authentication_error", "missing client_secret");
        return;
      }
      if (!verifySecret(clientSecret, intent.clientSecret)) {
        sendError(res, 403, "permission_error", "invalid client_secret");
        return;
      }

      const merchant = await Merchant.findById(session.merchantId);
      if (!merchant) {
        sendError(res, 404, "invalid_request_error", "checkout session not found");
        return;
      }
      const merchantDisplay = await resolveMerchantDisplay(merchant);
      res.status(200).json(toCheckoutSessionPublicDTO(session, merchantDisplay, intent));
    }),
  );

  return router;
}

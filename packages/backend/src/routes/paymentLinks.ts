import { Router } from "express";
import type { RequestHandler } from "express";
import type { FilterQuery } from "mongoose";
import { z } from "zod";
import { oxyClient } from "@oxyhq/core";
import { isBaseUnitString, type CreatePaymentLinkParams } from "@oxypay/shared-types";
import { Merchant } from "../models/Merchant";
import { PaymentLink } from "../models/PaymentLink";
import type { PaymentLinkDoc } from "../models/PaymentLink";
import { createIntent, NetworkMismatchError } from "../services/createIntent";
import { resolveMerchantDisplay } from "../services/merchantDisplay";
import { newId } from "../lib/ids";
import { toPaymentLinkDTO, toPublicPaymentLinkDTO, toPaymentIntentDTO } from "../lib/serialize";
import { sendError, wrap, requireAuthenticated } from "../lib/http";
import { resolveMerchant } from "./paymentIntents";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_LIST_LIMIT).optional(),
  starting_after: z.string().optional(),
});

const createBodySchema = z.object({
  amount: z
    .string()
    .refine(isBaseUnitString, "amount must be a base-unit integer string"),
  network: z.enum(["mainnet", "testnet"]),
  metadata: z.record(z.string(), z.string()).optional(),
  successUrl: z.string().url().optional(),
});

// Only `active`/`metadata`/`successUrl` are mutable — a link's price must be
// immutable once shared, so `amount`/`network` are deliberately absent here.
const patchBodySchema = z.object({
  active: z.boolean().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  successUrl: z.string().url().nullable().optional(),
});

/**
 * Build the payment-link REST router (F2.3). Merchant CRUD routes follow the
 * exact auth/scope chain as `paymentIntents.ts`/`merchants.ts`; the two
 * `/public` and `/payment_intent` routes are UNAUTHENTICATED payer paths,
 * gated only by the injected `publicRateLimit` — never a service token, since
 * an anonymous checkout-page visitor has none.
 */
export function createPaymentLinksRouter(deps: {
  requireMerchant: RequestHandler;
  publicRateLimit: RequestHandler;
}): Router {
  const { requireMerchant, publicRateLimit } = deps;
  const router = Router();

  router.post(
    "/v1/payment_links",
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
      const params: CreatePaymentLinkParams = parsed.data;

      // Same data-integrity firewall as `createIntent`'s network check
      // (F2.0 task 1a): a link's `network` must match the merchant it was
      // created under, since every intent it later mints derives its
      // watch-only address from THIS merchant's xpub.
      if (params.network !== merchant.network) {
        sendError(
          res,
          422,
          "invalid_request_error",
          `network '${params.network}' does not match the merchant's configured network '${merchant.network}'`,
        );
        return;
      }

      // Explicit field whitelist — never spread `req.body`.
      const link = await PaymentLink.create({
        publicId: newId("link"),
        merchantId: merchant.id,
        oxyAppId: merchant.oxyAppId,
        environment: merchant.environment,
        amount: params.amount,
        network: params.network,
        active: true,
        metadata: params.metadata
          ? new Map(Object.entries(params.metadata))
          : new Map<string, string>(),
        successUrl: params.successUrl,
      });

      res.status(201).json(toPaymentLinkDTO(link));
    }),
  );

  router.get(
    "/v1/payment_links",
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
      const { starting_after } = parsed.data;
      const limit = parsed.data.limit ?? DEFAULT_LIST_LIMIT;

      const filter: FilterQuery<PaymentLinkDoc> = { merchantId: merchant.id };
      if (starting_after) {
        const cursor = await PaymentLink.findOne({
          publicId: starting_after,
          merchantId: merchant.id,
        });
        if (!cursor) {
          sendError(
            res,
            422,
            "invalid_request_error",
            "starting_after references an unknown payment link",
          );
          return;
        }
        filter._id = { $lt: cursor._id };
      }

      const page = await PaymentLink.find(filter).sort({ _id: -1 }).limit(limit + 1);
      const hasMore = page.length > limit;
      const data = (hasMore ? page.slice(0, limit) : page).map((link) => toPaymentLinkDTO(link));

      res.status(200).json({ object: "list", data, has_more: hasMore });
    }),
  );

  router.get(
    "/v1/payment_links/:id",
    requireMerchant,
    requireAuthenticated,
    oxyClient.requireScope("payments:read"),
    wrap(async (req, res) => {
      const merchant = await resolveMerchant(req, res);
      if (!merchant) return;

      const link = await PaymentLink.findOne({
        publicId: req.params.id,
        merchantId: merchant.id,
      });
      if (!link) {
        sendError(res, 404, "invalid_request_error", "payment link not found");
        return;
      }
      res.status(200).json(toPaymentLinkDTO(link));
    }),
  );

  router.patch(
    "/v1/payment_links/:id",
    requireMerchant,
    requireAuthenticated,
    oxyClient.requireScope("payments:write"),
    wrap(async (req, res) => {
      const merchant = await resolveMerchant(req, res);
      if (!merchant) return;

      const link = await PaymentLink.findOne({
        publicId: req.params.id,
        merchantId: merchant.id,
      });
      if (!link) {
        sendError(res, 404, "invalid_request_error", "payment link not found");
        return;
      }

      const parsed = patchBodySchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(
          res,
          422,
          "invalid_request_error",
          parsed.error.issues[0]?.message ?? "invalid request body",
        );
        return;
      }
      const params = parsed.data;

      if (params.active !== undefined) link.active = params.active;
      if (params.metadata !== undefined) link.metadata = new Map(Object.entries(params.metadata));
      if (params.successUrl !== undefined) link.successUrl = params.successUrl ?? undefined;

      await link.save();
      res.status(200).json(toPaymentLinkDTO(link));
    }),
  );

  // Public payer path — UNAUTHENTICATED, rate-limited. Returns only
  // payer-safe fields (no metadata/successUrl/internal ids). Still returns
  // `active: false` links (never 404s an inactive link) so the checkout page
  // can render a "link disabled" state instead of a generic not-found.
  router.get(
    "/v1/payment_links/:id/public",
    publicRateLimit,
    wrap(async (req, res) => {
      const link = await PaymentLink.findOne({ publicId: req.params.id });
      if (!link) {
        sendError(res, 404, "invalid_request_error", "payment link not found");
        return;
      }
      const merchant = await Merchant.findById(link.merchantId);
      if (!merchant) {
        sendError(res, 404, "invalid_request_error", "payment link not found");
        return;
      }
      const merchantDisplay = await resolveMerchantDisplay(merchant);
      res.status(200).json(toPublicPaymentLinkDTO(link, merchantDisplay));
    }),
  );

  // Public payer path — UNAUTHENTICATED, rate-limited. Mints a FRESH intent
  // every call (the checkout page owns reuse-if-open via sessionStorage); every
  // value comes from the STORED link, never the caller, so a public caller can
  // never mint an intent for an amount/network/merchant it doesn't control.
  router.post(
    "/v1/payment_links/:id/payment_intent",
    publicRateLimit,
    wrap(async (req, res) => {
      const link = await PaymentLink.findOne({ publicId: req.params.id });
      if (!link) {
        sendError(res, 404, "invalid_request_error", "payment link not found");
        return;
      }
      if (!link.active) {
        sendError(res, 422, "invalid_request_error", "payment link is no longer active");
        return;
      }
      const merchant = await Merchant.findById(link.merchantId);
      if (!merchant) {
        sendError(res, 404, "invalid_request_error", "payment link not found");
        return;
      }

      try {
        const { intent } = await createIntent({
          merchant,
          amount: link.amount,
          network: link.network,
          metadata: Object.fromEntries(link.metadata),
        });
        res
          .status(201)
          .json({ ...toPaymentIntentDTO(intent), client_secret: intent.clientSecret });
      } catch (err) {
        // Structurally unreachable today (a link's `network` is validated
        // against its merchant at creation, and `Merchant.network` has no
        // mutation route) — kept as a defensive translation, same as every
        // other `createIntent` caller, rather than letting it fall through
        // to a bare 500 if that invariant is ever loosened.
        if (err instanceof NetworkMismatchError) {
          sendError(res, 422, "invalid_request_error", err.message);
          return;
        }
        throw err;
      }
    }),
  );

  return router;
}

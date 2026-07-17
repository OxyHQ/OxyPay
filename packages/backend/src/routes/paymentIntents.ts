import { Router } from "express";
import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import type { HydratedDocument } from "mongoose";
import { z } from "zod";
import { oxyClient } from "@oxyhq/core";
import { verifySecret } from "@oxyhq/core/server";
import type { OxyAuthRequest } from "@oxyhq/core/server";
import {
  isBaseUnitString,
  type CreatePaymentIntentParams,
  type PaymentIntentStatus,
} from "@oxypay/shared-types";
import { Merchant } from "../models/Merchant";
import type { MerchantDoc } from "../models/Merchant";
import { PaymentIntent } from "../models/PaymentIntent";
import { reserveNextAddress } from "../services/reserveAddress";
import { newId, clientSecretFor } from "../lib/ids";
import { applyEvent } from "../services/intentState";
import { toPaymentIntentDTO } from "../lib/serialize";

const DEFAULT_EXPIRY_SECONDS = 15 * 60;
const MS_PER_SECOND = 1000;
const MONGO_DUPLICATE_KEY = 11000;

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

// Stripe-ish error envelope: `{ error: { type, message } }`.
function sendError(
  res: Response,
  status: number,
  type: string,
  message: string,
): void {
  res.status(status).json({ error: { type, message } });
}

// Express 4 does not forward rejected promises to the error handler, so wrap
// each async handler and route any rejection to `next`.
type AsyncHandler = (req: Request, res: Response) => Promise<void>;
function wrap(handler: AsyncHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };
}

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === MONGO_DUPLICATE_KEY
  );
}

// Resolve the merchant behind the authenticated service app. Returns null AND
// writes the error response when the caller is unauthenticated (401) or the app
// has no registered merchant (403), so callers just `if (!merchant) return`.
async function resolveMerchant(
  req: Request,
  res: Response,
): Promise<HydratedDocument<MerchantDoc> | null> {
  const { serviceApp } = req as OxyAuthRequest;
  const appId = serviceApp?.appId;
  if (!appId) {
    sendError(res, 401, "authentication_error", "missing service app credentials");
    return null;
  }
  const merchant = await Merchant.findOne({ oxyAppId: appId });
  if (!merchant) {
    sendError(res, 403, "permission_error", "no merchant registered for this app");
    return null;
  }
  return merchant;
}

/**
 * Build the payment-intent REST router.
 *
 * `requireMerchant` is injectable so tests can bypass real Oxy service tokens
 * with a stub that populates `req.serviceApp`; in production it defaults to
 * `oxyClient.serviceAuth()` (confidential app-key auth). It is mounted only on
 * the merchant-authed routes — `submit_tx` is the payer path and is guarded by
 * the intent's `client_secret` instead.
 */
export function createPaymentIntentsRouter(deps?: {
  requireMerchant?: RequestHandler;
}): Router {
  const requireMerchant: RequestHandler =
    deps?.requireMerchant ?? oxyClient.serviceAuth();
  const router = Router();

  router.post(
    "/v1/payment_intents",
    requireMerchant,
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

      // Idempotency (fast path): a prior intent for this key wins as-is.
      const existing = await PaymentIntent.findOne({
        merchantId: merchant.id,
        idempotencyKey,
      });
      if (existing) {
        res
          .status(200)
          .json({ ...toPaymentIntentDTO(existing), client_secret: existing.clientSecret });
        return;
      }

      const { address } = await reserveNextAddress(merchant.id);
      const id = newId("pi");
      const clientSecret = clientSecretFor(id);
      const expiresInSeconds = params.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS;
      const expiresAt = new Date(Date.now() + expiresInSeconds * MS_PER_SECOND);

      try {
        // Explicit field whitelist — never spread `req.body` (mass-assignment
        // would be an IDOR).
        const intent = await PaymentIntent.create({
          id,
          status: "created",
          amount: params.amount,
          network: params.network,
          address,
          merchantId: merchant.id,
          txid: null,
          confirmations: 0,
          clientSecret,
          idempotencyKey,
          metadata: params.metadata
            ? new Map(Object.entries(params.metadata))
            : new Map<string, string>(),
          expiresAt,
        });
        res.status(201).json({ ...toPaymentIntentDTO(intent), client_secret: clientSecret });
      } catch (err) {
        // Idempotency (race path): a concurrent create with the same key lost
        // the unique-index bet — return the winner rather than erroring.
        if (isDuplicateKeyError(err)) {
          const winner = await PaymentIntent.findOne({
            merchantId: merchant.id,
            idempotencyKey,
          });
          if (winner) {
            res
              .status(200)
              .json({ ...toPaymentIntentDTO(winner), client_secret: winner.clientSecret });
            return;
          }
        }
        throw err;
      }
    }),
  );

  router.get(
    "/v1/payment_intents/:id",
    requireMerchant,
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
      res.status(200).json(toPaymentIntentDTO(intent));
    }),
  );

  router.post(
    "/v1/payment_intents/:id/reject",
    requireMerchant,
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

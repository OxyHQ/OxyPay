import { Router } from "express";
import type { RequestHandler } from "express";
import type { HydratedDocument } from "mongoose";
import mongoose from "mongoose";
import { oxyClient } from "@oxyhq/core";
import type { MerchantDoc } from "../models/Merchant";
import { PaymentIntent } from "../models/PaymentIntent";
import { WebhookDelivery } from "../models/WebhookDelivery";
import type { WebhookDeliveryDoc } from "../models/WebhookDelivery";
import { buildEvent, deliver, type SafeFetchFn } from "../services/webhookDispatcher";
import { toPaymentIntentDTO, toWebhookDeliveryDTO } from "../lib/serialize";
import { sendError, wrap, requireAuthenticated } from "../lib/http";
import { resolveMerchant } from "./paymentIntents";

export type RedeliverResult =
  | { ok: true; delivery: HydratedDocument<WebhookDeliveryDoc> }
  | { ok: false; status: number; message: string };

/**
 * Shared redeliver core (F2.5) — factored out so `POST
 * /v1/webhook_deliveries/:id/redeliver` (service-authed, below) and the
 * dashboard's `POST
 * /v1/dashboard/applications/:applicationId/webhook_deliveries/:id/redeliver`
 * (human-authed) run the EXACT same lookup/redelivery/log logic against
 * different auth paths, never two copies to keep in sync.
 */
export async function redeliverWebhookDelivery(
  merchant: HydratedDocument<MerchantDoc>,
  deliveryId: string,
  deps: { safeFetch?: SafeFetchFn } = {},
): Promise<RedeliverResult> {
  if (!mongoose.isValidObjectId(deliveryId)) {
    return { ok: false, status: 404, message: "webhook delivery not found" };
  }

  const delivery = await WebhookDelivery.findOne({ _id: deliveryId, merchantId: merchant.id });
  if (!delivery) {
    return { ok: false, status: 404, message: "webhook delivery not found" };
  }

  const intent = await PaymentIntent.findOne({ id: delivery.intentId, merchantId: merchant.id });
  if (!intent) {
    return {
      ok: false,
      status: 404,
      message: "the payment intent for this delivery no longer exists",
    };
  }

  if (!merchant.webhookUrl || !merchant.webhookSecret) {
    return { ok: false, status: 422, message: "merchant has no webhook configured" };
  }

  const event = buildEvent(delivery.eventType, toPaymentIntentDTO(intent));
  const outcome = await deliver(
    event,
    { url: merchant.webhookUrl, secret: merchant.webhookSecret },
    deps.safeFetch ? { safeFetch: deps.safeFetch } : {},
  );

  const redelivery = await WebhookDelivery.create({
    merchantId: merchant.id,
    intentId: intent.id,
    eventId: event.id,
    eventType: delivery.eventType,
    url: merchant.webhookUrl,
    attempts: outcome.attempts,
    delivered: outcome.delivered,
    lastStatus: outcome.delivered ? "delivered" : "failed",
  });

  return { ok: true, delivery: redelivery };
}

/**
 * Build the webhook-delivery REST router (F2.0 task 4's "reenviar" button).
 * `requireMerchant` follows the same injectable-default pattern as the other
 * routers; `safeFetch` is separately injectable so tests can capture the
 * outbound request without a real network call, mirroring how `createGateway`
 * already injects it for the settlement watcher's own webhook delivery.
 */
export function createWebhookDeliveriesRouter(deps: {
  requireMerchant: RequestHandler;
  safeFetch?: SafeFetchFn;
}): Router {
  const { requireMerchant, safeFetch } = deps;
  const router = Router();

  router.post(
    "/v1/webhook_deliveries/:id/redeliver",
    requireMerchant,
    requireAuthenticated,
    oxyClient.requireScope("payments:write"),
    wrap(async (req, res) => {
      const merchant = await resolveMerchant(req, res);
      if (!merchant) return;

      // `noUncheckedIndexedAccess` types `req.params.id` as possibly
      // `undefined` even though Express guarantees `:id` is present here.
      const { id: deliveryId } = req.params;
      if (!deliveryId) {
        sendError(res, 422, "invalid_request_error", "id is required");
        return;
      }

      const result = await redeliverWebhookDelivery(merchant, deliveryId, { safeFetch });
      if (!result.ok) {
        sendError(res, result.status, "invalid_request_error", result.message);
        return;
      }
      res.status(200).json(toWebhookDeliveryDTO(result.delivery));
    }),
  );

  return router;
}

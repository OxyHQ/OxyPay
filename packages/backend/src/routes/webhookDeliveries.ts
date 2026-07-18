import { Router } from "express";
import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { PaymentIntent } from "../models/PaymentIntent";
import { WebhookDelivery } from "../models/WebhookDelivery";
import { buildEvent, deliver, type SafeFetchFn } from "../services/webhookDispatcher";
import { toPaymentIntentDTO, toWebhookDeliveryDTO } from "../lib/serialize";
import { sendError, wrap } from "../lib/http";
import { resolveMerchant } from "./paymentIntents";

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
    wrap(async (req, res) => {
      const merchant = await resolveMerchant(req, res);
      if (!merchant) return;

      if (!mongoose.isValidObjectId(req.params.id)) {
        sendError(res, 404, "invalid_request_error", "webhook delivery not found");
        return;
      }

      const delivery = await WebhookDelivery.findOne({
        _id: req.params.id,
        merchantId: merchant.id,
      });
      if (!delivery) {
        sendError(res, 404, "invalid_request_error", "webhook delivery not found");
        return;
      }

      const intent = await PaymentIntent.findOne({
        id: delivery.intentId,
        merchantId: merchant.id,
      });
      if (!intent) {
        sendError(
          res,
          404,
          "invalid_request_error",
          "the payment intent for this delivery no longer exists",
        );
        return;
      }

      if (!merchant.webhookUrl || !merchant.webhookSecret) {
        sendError(res, 422, "invalid_request_error", "merchant has no webhook configured");
        return;
      }

      const event = buildEvent(delivery.eventType, toPaymentIntentDTO(intent));
      const outcome = await deliver(
        event,
        { url: merchant.webhookUrl, secret: merchant.webhookSecret },
        safeFetch ? { safeFetch } : {},
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

      res.status(200).json(toWebhookDeliveryDTO(redelivery));
    }),
  );

  return router;
}

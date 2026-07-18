import type { HydratedDocument } from "mongoose";
import type { Merchant, PaymentIntent, WebhookDelivery } from "@oxypay/shared-types";
import type { MerchantDoc } from "../models/Merchant";
import type { PaymentIntentDoc } from "../models/PaymentIntent";
import type { WebhookDeliveryDoc } from "../models/WebhookDelivery";

/** A persisted PaymentIntent document (includes the timestamp fields). */
export type PaymentIntentDocument = HydratedDocument<PaymentIntentDoc>;

/**
 * Serialize a persisted PaymentIntent document to its public `PaymentIntent`
 * DTO (the wire/contract shape shared with the SDK, webhooks, and the wallet).
 * The internal-only `idempotencyKey` is deliberately omitted; `metadata` is
 * flattened from a Mongo `Map` to a plain record; dates become ISO strings.
 */
export function toPaymentIntentDTO(doc: PaymentIntentDocument): PaymentIntent {
  return {
    id: doc.id,
    object: "payment_intent",
    status: doc.status,
    amount: doc.amount,
    currency: "FAIR",
    network: doc.network,
    address: doc.address,
    merchantId: doc.merchantId,
    txid: doc.txid,
    confirmations: doc.confirmations,
    clientSecret: doc.clientSecret,
    metadata: Object.fromEntries(doc.metadata),
    expiresAt: doc.expiresAt.toISOString(),
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/**
 * Serialize a persisted Merchant document to its public `Merchant` DTO.
 * `webhookSecret` and `nextDerivationIndex` are deliberately omitted (see
 * `@oxypay/shared-types`'s `Merchant` doc comment).
 */
export function toMerchantDTO(doc: HydratedDocument<MerchantDoc>): Merchant {
  return {
    id: doc.publicId,
    object: "merchant",
    oxyAppId: doc.oxyAppId,
    environment: doc.environment,
    network: doc.network,
    xpub: doc.xpub,
    webhookUrl: doc.webhookUrl,
    requiredConfirmations: doc.requiredConfirmations,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/**
 * Serialize a persisted WebhookDelivery document to its public
 * `WebhookDelivery` DTO. `WebhookDelivery` has no schema field named `id`, so
 * its Mongoose virtual `.id` is used directly here — unlike `Merchant`, there
 * is no collision to avoid.
 */
export function toWebhookDeliveryDTO(
  doc: HydratedDocument<WebhookDeliveryDoc>,
): WebhookDelivery {
  return {
    id: doc.id,
    object: "webhook_delivery",
    merchantId: doc.merchantId,
    intentId: doc.intentId,
    eventId: doc.eventId,
    eventType: doc.eventType,
    url: doc.url,
    attempts: doc.attempts,
    delivered: doc.delivered,
    lastStatus: doc.lastStatus,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

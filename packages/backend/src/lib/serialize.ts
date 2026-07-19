import type { HydratedDocument } from "mongoose";
import type {
  CheckoutSession,
  CheckoutSessionPublic,
  Merchant,
  MerchantDisplay,
  PaymentIntent,
  PaymentLink,
  PublicPaymentLink,
  WebhookDelivery,
} from "@oxypay/shared-types";
import { config } from "../config";
import type { MerchantDoc } from "../models/Merchant";
import type { PaymentIntentDoc } from "../models/PaymentIntent";
import type { PaymentLinkDoc } from "../models/PaymentLink";
import type { CheckoutSessionDoc } from "../models/CheckoutSession";
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

/**
 * Serialize a persisted PaymentLink document to its merchant-facing DTO
 * (the SDK/dashboard CRUD shape). `url` is built from `config.checkoutBaseUrl`
 * so it always points at the hosted checkout page for the CURRENT deploy.
 */
export function toPaymentLinkDTO(doc: HydratedDocument<PaymentLinkDoc>): PaymentLink {
  return {
    id: doc.publicId,
    object: "payment_link",
    amount: doc.amount,
    network: doc.network,
    active: doc.active,
    metadata: Object.fromEntries(doc.metadata),
    successUrl: doc.successUrl,
    url: `${config.checkoutBaseUrl}/l/${doc.publicId}`,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/**
 * Serialize a persisted PaymentLink document to what an UNAUTHENTICATED
 * checkout-page visitor may see: no `metadata`, no `successUrl`, no internal
 * ids beyond the public one. `merchant` is resolved separately by
 * `services/merchantDisplay.ts` and passed in — this function never touches
 * the network to build it.
 */
export function toPublicPaymentLinkDTO(
  doc: HydratedDocument<PaymentLinkDoc>,
  merchant: MerchantDisplay,
): PublicPaymentLink {
  return {
    id: doc.publicId,
    object: "payment_link",
    amount: doc.amount,
    network: doc.network,
    active: doc.active,
    merchant,
  };
}

/**
 * Serialize a persisted CheckoutSession document to its merchant/SDK-facing
 * DTO. The wrapped intent is passed in rather than re-fetched here, and
 * supplies both `paymentIntentId` and `clientSecret` — the session doc itself
 * deliberately never stores a copy of the secret (see `CheckoutSessionDoc`'s
 * doc comment).
 */
export function toCheckoutSessionDTO(
  doc: HydratedDocument<CheckoutSessionDoc>,
  intent: PaymentIntentDocument,
): CheckoutSession {
  return {
    id: doc.publicId,
    object: "checkout_session",
    paymentIntentId: intent.id,
    clientSecret: intent.clientSecret,
    amount: doc.amount,
    network: doc.network,
    metadata: Object.fromEntries(doc.metadata),
    successUrl: doc.successUrl,
    cancelUrl: doc.cancelUrl,
    url: `${config.checkoutBaseUrl}/c/${doc.publicId}`,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/**
 * Serialize a persisted CheckoutSession document to what the checkout page
 * loads at `/c/:id`, authorized by possession of the wrapped intent's
 * `client_secret` (see `routes/checkoutSessions.ts`'s public GET). Reuses
 * `toPaymentIntentDTO`'s output unchanged for `paymentIntent` — it already
 * carries `clientSecret`, which the page needs to open the socket and to
 * `submit_tx`.
 */
export function toCheckoutSessionPublicDTO(
  doc: HydratedDocument<CheckoutSessionDoc>,
  merchant: MerchantDisplay,
  intent: PaymentIntentDocument,
): CheckoutSessionPublic {
  return {
    id: doc.publicId,
    object: "checkout_session",
    successUrl: doc.successUrl,
    cancelUrl: doc.cancelUrl,
    merchant,
    paymentIntent: toPaymentIntentDTO(intent),
  };
}

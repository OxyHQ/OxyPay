import type { HydratedDocument } from "mongoose";
import type { PaymentIntent } from "@oxypay/shared-types";
import type { PaymentIntentDoc } from "../models/PaymentIntent";

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

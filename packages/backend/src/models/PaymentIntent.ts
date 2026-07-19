import { Schema, model } from "mongoose";
import type { NetworkType } from "@fairco.in/core";
import type { PaymentIntentStatus } from "@oxypay/shared-types";

/**
 * A payment intent document — the on-disk mirror of the `PaymentIntent` DTO.
 * `amount` is stored as a canonical base-unit string (never a float); the
 * domain converts to/from bigint via `lib/money`. `expiresAt` is a real Date;
 * `createdAt`/`updatedAt` come from the `timestamps` option.
 */
export interface PaymentIntentDoc {
  id: string;
  object: "payment_intent";
  status: PaymentIntentStatus;
  amount: string;
  currency: "FAIR";
  network: NetworkType;
  address: string;
  merchantId: string;
  txid: string | null;
  confirmations: number;
  clientSecret: string;
  idempotencyKey: string;
  metadata: Map<string, string>;
  expiresAt: Date;
  /** Populated by the schema `timestamps` option. */
  createdAt: Date;
  updatedAt: Date;
}

const paymentIntentSchema = new Schema<PaymentIntentDoc>(
  {
    id: { type: String, required: true, unique: true },
    object: { type: String, enum: ["payment_intent"], default: "payment_intent" },
    status: { type: String, required: true },
    amount: { type: String, required: true },
    currency: { type: String, enum: ["FAIR"], default: "FAIR" },
    network: { type: String, enum: ["mainnet", "testnet"], required: true },
    address: { type: String, required: true },
    merchantId: { type: String, required: true },
    txid: { type: String, default: null },
    confirmations: { type: Number, default: 0 },
    clientSecret: { type: String, required: true },
    idempotencyKey: { type: String, required: true },
    metadata: { type: Map, of: String, default: () => new Map<string, string>() },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// Stripe-style idempotency: one intent per (merchant, Idempotency-Key). A replay
// of the same key by the same merchant collides here rather than minting a twin.
paymentIntentSchema.index({ merchantId: 1, idempotencyKey: 1 }, { unique: true });

// `GET /v1/payment_intents` filters (and cursor-paginates) by `merchantId` —
// the compound unique index above is keyed on `idempotencyKey` second, so it
// can't serve that list query. This index turns it from a full collection
// scan into an index scan.
paymentIntentSchema.index({ merchantId: 1 });

// `services/enrichment.ts` resolves `PaymentIntent.find({ address: {$in} })`
// as its first address-keyed lookup — no other index covers `address`.
paymentIntentSchema.index({ address: 1 });

export const PaymentIntent = model<PaymentIntentDoc>(
  "PaymentIntent",
  paymentIntentSchema,
);

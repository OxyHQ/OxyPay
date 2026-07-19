import { Schema, model } from "mongoose";
import type { NetworkType } from "@fairco.in/core";
import { OXY_SERVICE_ENVIRONMENTS } from "@oxyhq/core/server";
import type { OxyServiceEnvironment } from "@oxyhq/core/server";

/**
 * Wraps exactly ONE `PaymentIntent`, created at session-create time, with
 * `successUrl`/`cancelUrl` for a hosted-checkout redirect flow (Stripe
 * Checkout Session parity, F2.2). Immutable after creation — there is no
 * PATCH route; a merchant that needs a different amount creates a new
 * session. The wrapped intent's `clientSecret` is deliberately NOT
 * duplicated here (`toCheckoutSessionDTO` reads it off the intent doc) so
 * there is exactly one place a client_secret is ever persisted.
 */
export interface CheckoutSessionDoc {
  /** Public Stripe-parity identifier (`cs_...`, minted via `newId("cs")`). */
  publicId: string;
  merchantId: string;
  /** Denormalized from the owning `Merchant` at creation time — see `PaymentLinkDoc`'s equivalent field for the rationale. */
  oxyAppId: string;
  environment: OxyServiceEnvironment;
  paymentIntentId: string;
  /** Amount in base units (m⊜) as a canonical integer string. Never a float. */
  amount: string;
  network: NetworkType;
  metadata: Map<string, string>;
  successUrl?: string;
  cancelUrl?: string;
  /** Populated by the schema `timestamps` option. */
  createdAt: Date;
  updatedAt: Date;
}

const checkoutSessionSchema = new Schema<CheckoutSessionDoc>(
  {
    publicId: { type: String, required: true, unique: true },
    merchantId: { type: String, required: true },
    oxyAppId: { type: String, required: true },
    environment: { type: String, enum: OXY_SERVICE_ENVIRONMENTS, required: true },
    paymentIntentId: { type: String, required: true },
    amount: { type: String, required: true },
    network: { type: String, enum: ["mainnet", "testnet"], required: true },
    metadata: { type: Map, of: String, default: () => new Map<string, string>() },
    successUrl: { type: String },
    cancelUrl: { type: String },
  },
  { timestamps: true },
);

// A merchant may create many sessions — non-unique, mirrors `PaymentLink`'s
// test/live scoping for any future app-scoped listing.
checkoutSessionSchema.index({ oxyAppId: 1, environment: 1 });

// The merchant-authed retrieve surface filters by `merchantId` — same
// rationale as `PaymentLink`'s equivalent index.
checkoutSessionSchema.index({ merchantId: 1 });

export const CheckoutSession = model<CheckoutSessionDoc>(
  "CheckoutSession",
  checkoutSessionSchema,
);

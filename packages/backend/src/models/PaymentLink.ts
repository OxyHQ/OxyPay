import { Schema, model } from "mongoose";
import type { NetworkType } from "@fairco.in/core";
import { OXY_SERVICE_ENVIRONMENTS } from "@oxyhq/core/server";
import type { OxyServiceEnvironment } from "@oxyhq/core/server";

/**
 * A shareable, reusable generator of `PaymentIntent`s (F2.3). A link's price
 * is immutable once shared — only `active`/`metadata`/`successUrl` are
 * mutable via `PATCH /v1/payment_links/:id`; `amount`/`network` never change
 * after creation. Each payer visit mints (or, at the checkout-page layer,
 * reuses an open) a fresh `PaymentIntent` bound to this link's
 * merchant/amount/network via `services/createIntent.ts`.
 */
export interface PaymentLinkDoc {
  /** Public Stripe-parity identifier (`link_...`, minted via `newId("link")`). */
  publicId: string;
  merchantId: string;
  /**
   * Denormalized from the owning `Merchant` at creation time (never mutated
   * afterward) so the merchant-authed list/create routes and any future
   * app-scoped admin tooling can filter by app/environment without a join —
   * same test/live isolation shape as `Merchant.environment`.
   */
  oxyAppId: string;
  environment: OxyServiceEnvironment;
  /** Amount in base units (m⊜) as a canonical integer string. Never a float. */
  amount: string;
  network: NetworkType;
  active: boolean;
  metadata: Map<string, string>;
  /** Optional post-payment redirect target for the checkout page. */
  successUrl?: string;
  /** Populated by the schema `timestamps` option. */
  createdAt: Date;
  updatedAt: Date;
}

const paymentLinkSchema = new Schema<PaymentLinkDoc>(
  {
    publicId: { type: String, required: true, unique: true },
    merchantId: { type: String, required: true },
    oxyAppId: { type: String, required: true },
    environment: { type: String, enum: OXY_SERVICE_ENVIRONMENTS, required: true },
    amount: { type: String, required: true },
    network: { type: String, enum: ["mainnet", "testnet"], required: true },
    active: { type: Boolean, default: true },
    metadata: { type: Map, of: String, default: () => new Map<string, string>() },
    successUrl: { type: String },
  },
  { timestamps: true },
);

// A merchant may have many links — non-unique, mirrors `Merchant`'s test/live
// scoping for any future app-scoped listing.
paymentLinkSchema.index({ oxyAppId: 1, environment: 1 });

// The merchant-authed `GET /v1/payment_links` list route filters (and
// cursor-paginates) by `merchantId` — same rationale as `PaymentIntent`'s
// equivalent index (`models/PaymentIntent.ts`).
paymentLinkSchema.index({ merchantId: 1 });

export const PaymentLink = model<PaymentLinkDoc>("PaymentLink", paymentLinkSchema);

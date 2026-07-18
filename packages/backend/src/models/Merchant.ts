import { Schema, model } from "mongoose";
import type { CallbackError, HydratedDocument } from "mongoose";
import { getNetwork } from "@fairco.in/core";
import type { NetworkType } from "@fairco.in/core";
import { OXY_SERVICE_ENVIRONMENTS } from "@oxyhq/core/server";
import type { OxyServiceEnvironment } from "@oxyhq/core/server";
import { deriveIntentAddress } from "../services/derivation";

/**
 * A merchant of the Oxy Pay Gateway. The non-custody firewall means this doc
 * holds ONLY a watch-only account `xpub` (public keys → cannot spend) — there
 * is deliberately NO field for a private key, mnemonic, or seed, and the
 * pre-validate hook refuses any private extended key handed in as `xpub`.
 */
export interface MerchantDoc {
  /**
   * Public Stripe-parity identifier (`merch_...`, minted via `newId("merch")`
   * at registration). Deliberately NOT named `id` — see the design note at
   * the top of Task 8 in the F2.0 plan: Mongoose's auto `id` virtual is
   * already relied on ecosystem-wide in this file as the Mongo-ObjectId
   * shortcut for `PaymentIntent.merchantId` FK writes.
   */
  publicId: string;
  oxyAppId: string;
  /**
   * Test/live isolation (F2.0): mirrors the `ApplicationCredential.environment`
   * that authenticated the call that registered this merchant. One `oxyAppId`
   * may have at most ONE `Merchant` per environment (compound unique index
   * below) — `resolveMerchant()` always resolves by BOTH fields together.
   */
  environment: OxyServiceEnvironment;
  network: NetworkType;
  xpub: string;
  nextDerivationIndex: number;
  webhookUrl?: string;
  webhookSecret?: string;
  requiredConfirmations: number;
  livemode: boolean;
  /** Display name shown in the payer's transaction history ("Paid at <name>"). */
  displayName?: string;
  /** Bare Oxy file id for the merchant's logo — canonical media chokepoint. */
  avatarFileId?: string;
  /** Short description shown alongside the merchant identity. */
  description?: string;
  /** Populated by the schema `timestamps` option. */
  createdAt: Date;
  updatedAt: Date;
}

const merchantSchema = new Schema<MerchantDoc>(
  {
    publicId: { type: String, required: true, unique: true },
    oxyAppId: { type: String, required: true },
    environment: { type: String, enum: OXY_SERVICE_ENVIRONMENTS, required: true },
    network: { type: String, enum: ["mainnet", "testnet"], required: true },
    xpub: { type: String, required: true },
    nextDerivationIndex: { type: Number, default: 0 },
    webhookUrl: { type: String },
    webhookSecret: { type: String },
    requiredConfirmations: { type: Number, default: 1 },
    livemode: { type: Boolean, default: false },
    displayName: { type: String },
    avatarFileId: { type: String },
    description: { type: String },
  },
  { timestamps: true },
);

// Test/live isolation (F2.0 task 1b): one Application (oxyAppId) may register
// at most one Merchant PER environment — a development-credential merchant and
// a production-credential merchant for the same app are distinct documents.
merchantSchema.index({ oxyAppId: 1, environment: 1 }, { unique: true });

/**
 * Non-custody firewall: prove the stored `xpub` is a spend-incapable, derivable
 * watch-only key by deriving index 0 from it. `deriveIntentAddress` throws if
 * the extended key carries a private key (an `xprv`) or is otherwise unusable —
 * we translate any such throw into a validation rejection so the merchant is
 * never persisted.
 */
merchantSchema.pre(
  "validate",
  function (this: HydratedDocument<MerchantDoc>, next: (err?: CallbackError) => void) {
    try {
      deriveIntentAddress(this.xpub, 0, 0, getNetwork(this.network));
      next();
    } catch (err) {
      next(err instanceof Error ? err : new Error("invalid watch-only xpub"));
    }
  },
);

export const Merchant = model<MerchantDoc>("Merchant", merchantSchema);

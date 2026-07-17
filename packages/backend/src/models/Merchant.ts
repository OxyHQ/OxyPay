import { Schema, model } from "mongoose";
import type { CallbackError, HydratedDocument } from "mongoose";
import { getNetwork } from "@fairco.in/core";
import type { NetworkType } from "@fairco.in/core";
import { deriveIntentAddress } from "../services/derivation";

/**
 * A merchant of the Oxy Pay Gateway. The non-custody firewall means this doc
 * holds ONLY a watch-only account `xpub` (public keys → cannot spend) — there
 * is deliberately NO field for a private key, mnemonic, or seed, and the
 * pre-validate hook refuses any private extended key handed in as `xpub`.
 */
export interface MerchantDoc {
  oxyAppId: string;
  network: NetworkType;
  xpub: string;
  nextDerivationIndex: number;
  webhookUrl?: string;
  webhookSecret?: string;
  requiredConfirmations: number;
  livemode: boolean;
}

const merchantSchema = new Schema<MerchantDoc>(
  {
    oxyAppId: { type: String, required: true, unique: true },
    network: { type: String, enum: ["mainnet", "testnet"], required: true },
    xpub: { type: String, required: true },
    nextDerivationIndex: { type: Number, default: 0 },
    webhookUrl: { type: String },
    webhookSecret: { type: String },
    requiredConfirmations: { type: Number, default: 1 },
    livemode: { type: Boolean, default: false },
  },
  { timestamps: true },
);

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

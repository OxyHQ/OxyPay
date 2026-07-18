import { Schema, model } from "mongoose";
import type { NetworkType } from "@fairco.in/core";

/**
 * Per-(user, network) counter for the social-receive address branch (design
 * spec §4.3). Mirrors `Merchant.nextDerivationIndex`'s atomic-reservation
 * pattern, but is lazily created on a user's FIRST social payment (there is
 * no merchant-style pre-registration step for an ordinary Oxy user) and
 * starts at index 1 — index 0 is the recipient's stable default/favourite
 * address and is never handed out through this reservation flow.
 */
export interface SocialReceiveCursorDoc {
  oxyUserId: string;
  network: NetworkType;
  nextDerivationIndex: number;
}

const socialReceiveCursorSchema = new Schema<SocialReceiveCursorDoc>({
  oxyUserId: { type: String, required: true },
  network: { type: String, enum: ["mainnet", "testnet"], required: true },
  nextDerivationIndex: { type: Number, default: 1 },
});

socialReceiveCursorSchema.index({ oxyUserId: 1, network: 1 }, { unique: true });

export const SocialReceiveCursor = model<SocialReceiveCursorDoc>(
  "SocialReceiveCursor",
  socialReceiveCursorSchema,
);

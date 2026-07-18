import { Schema, model } from "mongoose";
import type { NetworkType } from "@fairco.in/core";

/**
 * Records that a social-receive address (design spec §4.3) was minted for a
 * specific sender→recipient social payment (spec §4.8, bullets 2 and 3).
 * Keyed by the on-chain `address` — every non-default (index >= 1)
 * social-receive address is single-use, so `(address, network)` uniquely
 * identifies ONE payment relationship. Read by the enrichment service to
 * render "Sent to @alice" (sender's view) / "Received from @bob" (recipient's
 * view) without ever touching a private key.
 */
export interface SocialSendAttributionDoc {
  address: string;
  network: NetworkType;
  senderUserId: string;
  recipientUserId: string;
  index: number;
}

const socialSendAttributionSchema = new Schema<SocialSendAttributionDoc>(
  {
    address: { type: String, required: true },
    network: { type: String, enum: ["mainnet", "testnet"], required: true },
    senderUserId: { type: String, required: true },
    recipientUserId: { type: String, required: true },
    index: { type: Number, required: true },
  },
  { timestamps: true },
);

socialSendAttributionSchema.index({ address: 1, network: 1 }, { unique: true });

export const SocialSendAttribution = model<SocialSendAttributionDoc>(
  "SocialSendAttribution",
  socialSendAttributionSchema,
);

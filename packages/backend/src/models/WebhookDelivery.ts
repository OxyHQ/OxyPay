import { Schema, model } from "mongoose";
import type { WebhookEventType } from "@oxypay/shared-types";

/**
 * A log entry for one webhook delivery attempt. Keyed by `merchantId` (NOT
 * "the" webhook) — F2.0 keeps a single endpoint per merchant
 * (`Merchant.webhookUrl`/`webhookSecret`), but this shape stays additive if a
 * future `WebhookEndpoint` (N endpoints per merchant, event filters) lands:
 * this log would just gain an `endpointId` field rather than being rewritten.
 */
export interface WebhookDeliveryDoc {
  merchantId: string;
  intentId: string;
  eventId: string;
  eventType: WebhookEventType;
  url: string;
  attempts: number;
  delivered: boolean;
  lastStatus: "delivered" | "failed";
  createdAt: Date;
  updatedAt: Date;
}

const webhookDeliverySchema = new Schema<WebhookDeliveryDoc>(
  {
    merchantId: { type: String, required: true, index: true },
    intentId: { type: String, required: true },
    eventId: { type: String, required: true },
    eventType: { type: String, required: true },
    url: { type: String, required: true },
    attempts: { type: Number, required: true },
    delivered: { type: Boolean, required: true },
    lastStatus: { type: String, enum: ["delivered", "failed"], required: true },
  },
  { timestamps: true },
);

export const WebhookDelivery = model<WebhookDeliveryDoc>(
  "WebhookDelivery",
  webhookDeliverySchema,
);

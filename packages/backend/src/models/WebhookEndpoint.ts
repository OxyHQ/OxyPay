import mongoose, { Schema, type Document, type Model } from 'mongoose';
import type { WebhookEventType } from '@oxypay/shared-types';

export interface WebhookEndpointDocument extends Document<string> {
  _id: string;
  /** Oxy developer-app id that owns this endpoint. */
  appId: string;
  url: string;
  /** HMAC-SHA256 secret used to sign deliveries. */
  secret: string;
  events: WebhookEventType[];
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const WebhookEndpointSchema = new Schema<WebhookEndpointDocument>(
  {
    _id: { type: String, required: true },
    appId: { type: String, required: true, index: true },
    url: { type: String, required: true },
    secret: { type: String, required: true },
    events: { type: [String], required: true, default: [] },
    enabled: { type: Boolean, required: true, default: true },
  },
  { timestamps: true, _id: false }
);

export const WebhookEndpoint: Model<WebhookEndpointDocument> =
  (mongoose.models.WebhookEndpoint as Model<WebhookEndpointDocument>) ||
  mongoose.model<WebhookEndpointDocument>('WebhookEndpoint', WebhookEndpointSchema);

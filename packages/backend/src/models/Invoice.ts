import mongoose, { Schema, type Document, type Model } from 'mongoose';
import type { Currency, InvoiceLineItem, InvoiceStatus } from '@oxypay/shared-types';

export interface InvoiceDocument extends Document<string> {
  _id: string;
  merchantId: string;
  customerId?: string;
  amount: string;
  currency: Currency;
  items?: InvoiceLineItem[];
  description?: string;
  appId?: string;
  idempotencyKey?: string;
  successUrl?: string;
  cancelUrl?: string;
  webhookUrl?: string;
  status: InvoiceStatus;
  expiresAt?: Date;
  paymentId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const InvoiceSchema = new Schema<InvoiceDocument>(
  {
    _id: { type: String, required: true },
    merchantId: { type: String, required: true, index: true },
    customerId: { type: String, index: true, sparse: true },
    amount: { type: String, required: true },
    currency: { type: String, required: true },
    items: { type: Schema.Types.Mixed },
    description: { type: String },
    appId: { type: String, index: true, sparse: true },
    idempotencyKey: { type: String, index: true, sparse: true },
    successUrl: { type: String },
    cancelUrl: { type: String },
    webhookUrl: { type: String },
    status: { type: String, required: true, index: true, default: 'open' },
    expiresAt: { type: Date, index: true, sparse: true },
    paymentId: { type: String, sparse: true },
  },
  { timestamps: true, _id: false }
);

InvoiceSchema.index({ merchantId: 1, createdAt: -1 });
InvoiceSchema.index({ appId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

export const Invoice: Model<InvoiceDocument> =
  (mongoose.models.Invoice as Model<InvoiceDocument>) ||
  mongoose.model<InvoiceDocument>('Invoice', InvoiceSchema);

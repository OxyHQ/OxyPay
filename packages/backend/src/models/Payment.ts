import mongoose, { Schema, type Document, type Model } from 'mongoose';
import type { Currency, PaymentMethodId, PaymentStatus } from '@oxypay/shared-types';

export interface PaymentDocument extends Document<string> {
  _id: string;
  payerId: string;
  merchantId?: string;
  recipientId?: string;
  invoiceId?: string;
  amount: string;
  currency: Currency;
  method: PaymentMethodId;
  status: PaymentStatus;
  description?: string;
  succeededAt?: Date;
  errorCode?: string;
  errorMessage?: string;
  refundedAmount?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema = new Schema<PaymentDocument>(
  {
    _id: { type: String, required: true },
    payerId: { type: String, required: true, index: true },
    merchantId: { type: String, index: true, sparse: true },
    recipientId: { type: String, index: true, sparse: true },
    invoiceId: { type: String, index: true, sparse: true },
    amount: { type: String, required: true },
    currency: { type: String, required: true },
    method: { type: String, required: true },
    status: { type: String, required: true, index: true },
    description: { type: String },
    succeededAt: { type: Date },
    errorCode: { type: String },
    errorMessage: { type: String },
    refundedAmount: { type: String },
  },
  { timestamps: true, _id: false }
);

PaymentSchema.index({ payerId: 1, createdAt: -1 });
PaymentSchema.index({ merchantId: 1, createdAt: -1 });

export const Payment: Model<PaymentDocument> =
  (mongoose.models.Payment as Model<PaymentDocument>) ||
  mongoose.model<PaymentDocument>('Payment', PaymentSchema);

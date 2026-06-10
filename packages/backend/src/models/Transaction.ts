import mongoose, { Schema, type Document, type Model } from 'mongoose';
import type { Currency, TransactionStatus, TransactionType } from '@oxypay/shared-types';

export interface TransactionDocument extends Document {
  _id: string;
  walletId: string;
  userId: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: string;
  currency: Currency;
  fee?: string;
  counterpartyUserId?: string;
  counterpartyUsername?: string;
  externalRef?: string;
  note?: string;
  paymentId?: string;
  invoiceId?: string;
  confirmedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TransactionSchema = new Schema<TransactionDocument>(
  {
    _id: { type: String, required: true },
    walletId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    type: { type: String, required: true, index: true },
    status: { type: String, required: true, index: true },
    amount: { type: String, required: true },
    currency: { type: String, required: true },
    fee: { type: String },
    counterpartyUserId: { type: String, index: true },
    counterpartyUsername: { type: String },
    externalRef: { type: String, index: true, sparse: true },
    note: { type: String, maxlength: 280 },
    paymentId: { type: String, index: true, sparse: true },
    invoiceId: { type: String, index: true, sparse: true },
    confirmedAt: { type: Date },
  },
  { timestamps: true, _id: false }
);

TransactionSchema.index({ userId: 1, createdAt: -1 });
TransactionSchema.index({ walletId: 1, createdAt: -1 });

export const Transaction: Model<TransactionDocument> =
  (mongoose.models.Transaction as Model<TransactionDocument>) ||
  mongoose.model<TransactionDocument>('Transaction', TransactionSchema);

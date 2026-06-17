import mongoose, { Schema, type Document, type Model } from 'mongoose';
import type { Currency } from '@oxypay/shared-types';

export interface WalletDocument extends Document<string> {
  _id: string;
  userId: string;
  currency: Currency;
  /** Stored as a decimal string in the smallest unit. */
  balance: string;
  pending: string;
  frozen: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const WalletSchema = new Schema<WalletDocument>(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    currency: { type: String, required: true, index: true },
    balance: { type: String, required: true, default: '0' },
    pending: { type: String, required: true, default: '0' },
    frozen: { type: Boolean, required: true, default: false },
  },
  { timestamps: true, _id: false }
);

WalletSchema.index({ userId: 1, currency: 1 }, { unique: true });

export const Wallet: Model<WalletDocument> =
  (mongoose.models.Wallet as Model<WalletDocument>) ||
  mongoose.model<WalletDocument>('Wallet', WalletSchema);

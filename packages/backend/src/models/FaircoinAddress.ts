import mongoose, { Schema, type Document, type Model } from 'mongoose';

/**
 * Maps a custodial deposit address to the user it was issued to and the BIP44
 * derivation index used to produce it. Each row corresponds to exactly one
 * HD-derived address (account=0, change=0, index=derivationIndex) that the
 * FairCoin node is told to watch (`importaddress`).
 *
 * Uniqueness invariants:
 * - one address per user (`userId` unique)
 * - one user per address (`address` unique)
 * - one user per derivation index (`derivationIndex` unique) — the Counter
 *   model allocates these atomically so concurrent issuance never collides.
 */
export interface FaircoinAddressDocument extends Document<string> {
  _id: string;
  userId: string;
  address: string;
  derivationIndex: number;
  createdAt: Date;
  updatedAt: Date;
}

const FaircoinAddressSchema = new Schema<FaircoinAddressDocument>(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, unique: true },
    address: { type: String, required: true, unique: true },
    derivationIndex: { type: Number, required: true, unique: true },
  },
  { timestamps: true, _id: false }
);

export const FaircoinAddress: Model<FaircoinAddressDocument> =
  (mongoose.models.FaircoinAddress as Model<FaircoinAddressDocument>) ||
  mongoose.model<FaircoinAddressDocument>('FaircoinAddress', FaircoinAddressSchema);

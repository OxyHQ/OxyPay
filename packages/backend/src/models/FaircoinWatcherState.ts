import mongoose, { Schema, type Document, type Model } from 'mongoose';

/**
 * Single-document collection persisting the deposit watcher's progress. The
 * watcher uses `listsinceblock <lastScannedBlockHash>` to fetch wallet
 * transactions since the last block it processed, then advances the cursor to
 * the `lastblock` returned by the RPC.
 *
 * Re-credits are made impossible by the per-(txid:vout) idempotency check in
 * the watcher, so re-scanning an overlapping range is always safe.
 */
export interface FaircoinWatcherStateDocument extends Document<string> {
  _id: string;
  lastScannedBlockHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

const FaircoinWatcherStateSchema = new Schema<FaircoinWatcherStateDocument>(
  {
    _id: { type: String, required: true },
    lastScannedBlockHash: { type: String },
  },
  { timestamps: true, _id: false }
);

export const FaircoinWatcherState: Model<FaircoinWatcherStateDocument> =
  (mongoose.models.FaircoinWatcherState as Model<FaircoinWatcherStateDocument>) ||
  mongoose.model<FaircoinWatcherStateDocument>('FaircoinWatcherState', FaircoinWatcherStateSchema);

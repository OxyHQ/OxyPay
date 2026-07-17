import mongoose, { Schema, type Document, type Model } from 'mongoose';

/**
 * A generic atomic sequence counter. Used to allocate FairCoin derivation
 * indices without collisions under concurrency:
 *
 *   const doc = await Counter.findByIdAndUpdate(
 *     id,
 *     { $inc: { seq: 1 } },
 *     { new: true, upsert: true, setDefaultsOnInsert: true },
 *   );
 *
 * The `$inc` + `upsert` combination is atomic at the document level in
 * MongoDB, so two concurrent callers always receive two distinct `seq`
 * values. Gaps (a value allocated but never used) are acceptable.
 */
export interface CounterDocument extends Document<string> {
  _id: string;
  seq: number;
  createdAt: Date;
  updatedAt: Date;
}

const CounterSchema = new Schema<CounterDocument>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { timestamps: true, _id: false }
);

export const Counter: Model<CounterDocument> =
  (mongoose.models.Counter as Model<CounterDocument>) ||
  mongoose.model<CounterDocument>('Counter', CounterSchema);

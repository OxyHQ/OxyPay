import mongoose from "mongoose";
import { config } from "./config";

/**
 * Connect to MongoDB. Idempotent-ish: Mongoose maintains a single default
 * connection, so calling this once at boot is sufficient. The URI defaults to
 * the configured value but is injectable for tests (in-memory server).
 */
export async function connectDb(uri: string = config.mongodbUri): Promise<void> {
  await mongoose.connect(uri);
}

/** Close the MongoDB connection (used on shutdown and in tests). */
export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

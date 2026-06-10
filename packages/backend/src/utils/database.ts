import mongoose from 'mongoose';

const DEFAULT_URI = 'mongodb://localhost:27017/oxypay';

let connectingPromise: Promise<typeof mongoose> | null = null;

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }
  if (connectingPromise) {
    return connectingPromise;
  }
  const uri = process.env.MONGODB_URI || DEFAULT_URI;
  connectingPromise = mongoose
    .connect(uri, {
      dbName: process.env.MONGODB_DB_NAME || 'oxypay',
      serverSelectionTimeoutMS: 8000,
    })
    .then((conn) => {
      console.log(`[oxypay] mongo connected to ${uri.replace(/\/\/.*@/, '//***@')}`);
      return conn;
    })
    .catch((err) => {
      connectingPromise = null;
      throw err;
    });
  return connectingPromise;
}

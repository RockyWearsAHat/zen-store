import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

// Don’t queue ops while disconnected – fail fast instead of 10 s buffer timeout
mongoose.set("bufferCommands", false);

// Variable to cache the Mongoose connection
let cachedConnection: typeof mongoose | null = null;
let connecting: Promise<typeof mongoose> | null = null; // in-flight promise

export async function connectDB() {
  // ✅ reuse when connected or still connecting
  if (cachedConnection && cachedConnection.connection.readyState === 1) {
    return cachedConnection;
  }
  if (connecting) {
    return connecting; // awaiting the ongoing connect()
  }

  if (!process.env.MONGODB_URI) {
    throw new Error(
      "[MongoDB] Please define the MONGODB_URI environment variable (currently undefined)"
    );
  }

  try {
    connecting = mongoose
      .connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5_000 })
      .then((conn) => {
        cachedConnection = conn;
        connecting = null;
        return conn;
      })
      .catch((err) => {
        connecting = null; // allow retry
        throw err;
      });
    return await connecting;
  } catch (error) {
    console.error("[MongoDB] Database connection error:", error);
    cachedConnection = null;
    throw error; // Re-throw the error to be caught by the caller
  }
}

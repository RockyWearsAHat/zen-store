import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

// Don’t queue ops while disconnected – fail fast instead of 10 s buffer timeout
mongoose.set("bufferCommands", false);

// Variable to cache the Mongoose connection
let cachedConnection: typeof mongoose | null = null;

export async function connectDB() {
  // Re-use only when connection is really open
  if (
    cachedConnection &&
    cachedConnection.connection.readyState === 1 /* connected */
  ) {
    return cachedConnection;
  }

  if (!process.env.MONGODB_URI) {
    throw new Error(
      "[MongoDB] Please define the MONGODB_URI environment variable (currently undefined)"
    );
  }

  try {
    // console.log("[MongoDB] Attempting to connect to database...");
    cachedConnection = await mongoose.connect(process.env.MONGODB_URI, {
      // tune server selection to fail faster
      serverSelectionTimeoutMS: 5_000,
    });
    console.log("[MongoDB] Database connected successfully");
    return cachedConnection;
  } catch (error) {
    console.error("[MongoDB] Database connection error:", error);
    cachedConnection = null; // allow next call to retry
    throw error; // Re-throw the error to be caught by the caller
  }
}

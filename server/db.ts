import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

// Variable to cache the Mongoose connection
let cachedConnection: typeof mongoose | null = null;

export async function connectDB() {
  if (cachedConnection) {
    // console.log("[MongoDB] Using cached database connection");
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
      // Options to avoid deprecation warnings, adjust as needed for your Mongoose version
      // useNewUrlParser: true, // Deprecated in Mongoose 6+
      // useUnifiedTopology: true, // Deprecated in Mongoose 6+
      // bufferCommands: false, // Disable command buffering if you want to handle connection errors explicitly
    });
    console.log("[MongoDB] Database connected successfully");
    return cachedConnection;
  } catch (error) {
    console.error("[MongoDB] Database connection error:", error);
    // Set cachedConnection to null on failure to allow retries on subsequent calls
    cachedConnection = null;
    throw error; // Re-throw the error to be caught by the caller
  }
}

import mongoose from "mongoose";

const uri = process.env.MONGO_URI;

export async function connectDB(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return mongoose; // already open
  try {
    return await mongoose.connect(uri ?? "");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    throw error;
  }
}

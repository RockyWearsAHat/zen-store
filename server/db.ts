import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

mongoose.connect(process.env.MONGO_URI ?? "", {
  retryWrites: true,
  retryReads: true,
});
mongoose.connection.on("error", console.log.bind(console, "connection error:"));
mongoose.connection.once("open", () => {
  console.log("Connected to Mongo");
});

export const db = mongoose.connection;

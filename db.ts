import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

mongoose.connect(
  process.env.MONGO_LOCAL
    ? ``
    : `mongodb+srv://${process.env.MONGO_USERNAME}:${process.env.MONGO_PASSWORD}@cluster0.8rpqnmn.mongodb.net/balls?retryWrites=true&w=majority`,
  {
    retryWrites: true,
    retryReads: true,
  }
);
mongoose.connection.on("error", console.log.bind(console, "connection error:"));
mongoose.connection.once("open", () => {
  console.log("Connected to Mongo");
});

export const db = mongoose.connection;

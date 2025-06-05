import "dotenv/config";
import express from "express";
import serverless from "serverless-http";
import { router as masterRouter } from "./masterRouter";
import { stripeWebhookRouter } from "../routers/stripeWebhook";

const app = express();

export default app;

// 1️⃣ Mount Stripe webhook route FIRST, before any body parser
app.use("/api/webhook", stripeWebhookRouter);

/* ── 2️⃣  normal body parsers for the rest ── */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 3️⃣ Mount all other API routes
app.use(masterRouter);

// Health check endpoint for server
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
  return;
});

const startServer = () => {
  if (process.env && process.env["VITE"]) {
    // If running in dev, just run the server from vite, vite plugin to run express is used (SEE vite.config.ts)
    return console.log("Running in dev mode");
    // DO NOT mount express.static or catch-all route in dev mode!
  } else {
    // Serve static files from dist (not public) in production
    const frontendFiles = process.cwd() + "/dist/";
    app.use(express.static(frontendFiles));

    // Only serve index.html for requests that accept HTML (not for assets)
    app.get("/{*splat}", async (_, res) => {
      // if (req.accepts("html") && !req.path.match(/\.[a-zA-Z0-9]+$/)) {
      res.sendFile("index.html", { root: frontendFiles });
      // return;
      // }
    });

    //If running on netlify, server is ran via lamda functions created by serverless-http,
    //so if not, start the server, stupid nested if because return can't happen here bc I'm dumb
    //and I don't want to use a function

    if (process.env["NETLIFY"]) return;

    app.listen(process.env.PORT || 4000, () => {
      console.log(
        !process.env["PORT"]
          ? "Server started on http://localhost:4000"
          : `Server started on http://localhost:${process.env["PORT"]}`
      );
    });
  }
};

startServer();

export const handler = serverless(app);

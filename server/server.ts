import "dotenv/config"; // ensures env vars are loaded immediately
import express, { Request, Response } from "express";
import checkoutRouter from "./checkout";
import webhookRouter from "./stripeWebhook";
import serverless from "serverless-http";
import path from "path"; // new

// If needed, still call dotenv.config() again:
// import dotenv from "dotenv";
// dotenv.config();

export const app = express();

/* ── 1️⃣  mount webhook at /webhook  ── */
app.use("/webhook", webhookRouter); // POST /webhook

app.get("/test", (req: Request, res: Response) => {
  res.json({ test: "Hello from the test route!" });
});

/* ── 2️⃣  normal body parsers for the rest ── */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(checkoutRouter); // POST /create-checkout-session

if (process.env !== undefined && process.env["VITE"]) {
  //If running in dev, just run the server from vite, vite plugin to run express is used (SEE vite.config.ts)
  console.log("Running in dev mode");
} else {
  if (!process.env["VITE"]) {
    // --- new landing route ---
    const landingPath = path.join(process.cwd(), "public", "landing.html");
    app.get("/", (_: Request, res: Response) => {
      res.sendFile(landingPath);
    });
    // --- end new landing route ---

    const frontendFiles = process.cwd() + "/dist/";
    app.use(express.static(frontendFiles));

    app.get("/*", (_: Request, res: Response) => {
      res.sendFile("index.html", { root: frontendFiles });
    });

    //If running on netlify, server is ran via lamda functions created by serverless-http
    if (!process.env.NETLIFY) {
      app.listen(process.env["PORT"] ? process.env["PORT"] : 4000, () => {
        console.log(
          !process.env["PORT"] ? "Server started on http://localhost:4000" : ""
        );
      });
    }
  }
}

export const handler = serverless(app);

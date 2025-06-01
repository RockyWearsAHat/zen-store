import "dotenv/config"; // ensures env vars are loaded immediately
import express, { Request, Response, json, urlencoded } from "express";
import { checkoutRouter } from "../routers/checkout";
import { stripeWebhookRouter } from "../routers/stripeWebhook";
import { aliexpressOAuthRouter } from "../routers/aliexpressOAuth";
import serverless from "serverless-http";

// If needed, still call dotenv.config() again:
// import dotenv from "dotenv";
// dotenv.config();

export const app = express();

// ---------- add OAuth routes ----------
app.use(aliexpressOAuthRouter); // ← add
// ---------- end OAuth mount -------------

// Mount webhook route first, before body parsers
app.use("/api/webhook", stripeWebhookRouter);

/* ── 2️⃣  normal body parsers for the rest ── */
app.use(json());
app.use(urlencoded({ extended: true }));

// Mount the rest of the API routes
app.use("/api", checkoutRouter);

if (process.env !== undefined && process.env["VITE"]) {
  //If running in dev, just run the server from vite, vite plugin to run express is used (SEE vite.config.ts)
  console.log("Running in dev mode");
} else {
  if (!process.env["VITE"]) {
    const frontendFiles = process.cwd() + "/dist/";
    app.use(express.static(frontendFiles));

    app.get("/{*splat}", (_: Request, res: Response) => {
      res.sendFile("index.html", { root: frontendFiles });
    });

    //If running on netlify, server is ran via lamda functions created by serverless-http,
    //so if not, start the server, stupid nested if because return can't happen here bc I'm dumb
    //and I don't want to use a function
    if (!process.env.NETLIFY) {
      app.listen(process.env.PORT || 4000, () => {
        console.log(
          !process.env["PORT"] ? "Server started on http://localhost:4000" : ""
        );
      });
    }
  }
}

export const handler = serverless(app);

import { Router } from "express";
import { aliexpressRouter } from "../routers/aliexpress";
import { checkoutRouter } from "../routers/checkout";

export const router = Router();

// AliExpress related routes
router.use("/ali", aliexpressRouter);

// Mount the rest of the API routes
router.use("/api", checkoutRouter);

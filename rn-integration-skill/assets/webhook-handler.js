// Request Network webhook handler (Express) — drop-in starting point.
//
// Verifies the HMAC-SHA256 signature against the RAW request body, dedupes on the
// delivery id, and dispatches on event type. Mount it on your server and set
// RN_WEBHOOK_SECRET (the secret returned once by POST /v1/webhook).
//
//   import express from "express";
//   import { requestNetworkWebhook } from "./webhook-handler.js";
//   const app = express();
//   app.post("/webhooks/request-network", ...requestNetworkWebhook({ onConfirmed, onPartial, onFailed }));
//   app.listen(3000);

import crypto from "node:crypto";
import express from "express";

function verifySignature(rawBody, signature, secret) {
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// In-memory idempotency cache. Replace with Redis/DB in production.
const seenDeliveries = new Set();

/**
 * Returns [rawBodyMiddleware, handler] so you can spread them into app.post(...).
 * Pass async callbacks; each receives the parsed webhook body.
 */
export function requestNetworkWebhook({ onConfirmed, onPartial, onFailed, onEvent } = {}) {
  const rawBodyMiddleware = express.raw({
    type: "application/json",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  });

  const handler = async (req, res) => {
    const secret = process.env.RN_WEBHOOK_SECRET;
    if (!secret) return res.status(500).json({ error: "RN_WEBHOOK_SECRET not set" });

    const signature = req.headers["x-request-network-signature"];
    if (!signature || !verifySignature(req.rawBody, signature, secret)) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    let body;
    try {
      body = JSON.parse(req.rawBody.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }

    // Idempotency: scoped events fire alongside core events; dedupe on delivery id.
    const deliveryId = req.headers["x-request-network-delivery"];
    if (deliveryId) {
      if (seenDeliveries.has(deliveryId)) return res.status(200).json({ ok: true, duplicate: true });
      seenDeliveries.add(deliveryId);
    }

    // Acknowledge fast (5s timeout). Do heavy work without blocking the response.
    res.status(200).json({ ok: true });

    try {
      await onEvent?.(body);
      switch (body.event) {
        case "payment.confirmed":
        case "payment.confirmed.checkout":
        case "payment.confirmed.client_id":
          await onConfirmed?.(body);
          break;
        case "payment.partial":
        case "payment.partial.checkout":
        case "payment.partial.client_id":
          await onPartial?.(body);
          break;
        case "payment.failed":
          await onFailed?.(body);
          break;
        default:
          // Unknown / unhandled event — ignore gracefully.
          break;
      }
    } catch (err) {
      // Already responded 200; log for your own ret/ alerting.
      console.error("Webhook processing error:", err);
    }
  };

  return [rawBodyMiddleware, handler];
}

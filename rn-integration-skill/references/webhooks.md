# Webhooks & reconciliation

Webhooks are how you reliably learn that a payment settled on-chain. Wire them up for both
the hosted and embedded flows. Never drive fulfillment from a frontend "success" alone.

Auth API base: `https://auth.request.network/v1`

## Register and manage

Each webhook is scoped to the **Client ID** that creates it and receives events for
everything created with that Client ID. There is no Dashboard UI — manage via the Auth API.

```bash
# Create — returns the signing secret ONCE
curl -X POST "https://auth.request.network/v1/webhook" \
  -H "Content-Type: application/json" -H "x-client-id: $RN_CLIENT_ID" \
  -d '{ "url": "https://yoursite.com/webhooks/request-network" }'
# => { "id": "01KJC2WX...", "secret": "f3c189a4..." }  ← store secret as RN_WEBHOOK_SECRET
```

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/v1/webhook` | List webhooks for this Client ID |
| `PUT` | `/v1/webhook/:id` | Toggle active / inactive |
| `DELETE` | `/v1/webhook/:id` | Permanently delete |
| `POST` | `/v1/webhook/test` | Body `{ "eventType": "payment.confirmed" }` — fire a test |

The secret is shown only at creation and cannot be retrieved again. Use HTTPS in production;
`localhost`/ngrok URLs are accepted for local testing.

## Signature verification (mandatory)

Every delivery carries an HMAC-SHA256 signature in `x-request-network-signature`, computed
over the **raw request body** with your webhook secret. Verify against the raw bytes
*before* JSON-parsing, and use a timing-safe compare.

```javascript
import crypto from "node:crypto";

function verify(rawBody, signature, secret) {
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch { return false; }
}
```

If you let your framework auto-parse JSON, you may lose the exact bytes and the signature
will never match. Capture the raw body (examples below).

## Request headers

| Header | Meaning |
| ------ | ------- |
| `x-request-network-signature` | HMAC-SHA256 of the raw body |
| `x-request-network-delivery` | Unique delivery ULID — use for idempotency |
| `x-request-network-retry-count` | Retry attempt, 0–3 |
| `x-request-network-test` | `true` for test deliveries |

## Event catalog

Core payment events:

| Event | Meaning |
| ----- | ------- |
| `payment.confirmed` | Fully settled — fulfill the order. |
| `payment.partial` | Partial amount received; update balance. |
| `payment.failed` | Execution failed (recurring/cross-chain). |
| `payment.refunded` | Refunded to payer. |

Scoped duplicates (emitted **in addition to** the core event):
- `payment.confirmed.client_id`, `payment.partial.client_id` — when created with a Client ID
  (payload adds `clientId`, `origin`).
- `payment.confirmed.checkout`, `payment.partial.checkout` — when created via a Secure
  Payment / checkout link.

> Because scoped variants fire alongside the core event, dedupe by `requestId` (or the
> delivery ULID) so you don't fulfill an order twice.

Other events: `payment.processing` (crypto-to-fiat, with `subStatus`), `request.recurring`
(new recurring request generated), `compliance.updated` (KYC/agreement status),
`payment_detail.updated` (bank verification).

### Sample `payment.confirmed` payload

```json
{
  "event": "payment.confirmed",
  "requestId": "0151b394...d1fafa93",
  "paymentReference": "0x2c3366941274c34c",
  "explorer": "https://scan.request.network/request/0151b394...d1fafa93",
  "amount": "100.0", "totalAmountPaid": "100.0", "expectedAmount": "100.0",
  "txHash": "0xabcdef...", "network": "ethereum",
  "currency": "USDC", "paymentCurrency": "USDC",
  "timestamp": "2025-10-03T14:30:00Z",
  "paymentProcessor": "request-network",
  "fees": [{ "type": "network", "amount": "0.02", "currency": "ETH" }]
}
```

Match `requestId` (or `paymentReference`) back to the `reference`/`requestIds` you stored at
creation time.

## Retry & response behavior

- Up to 3 retries (4 attempts total), delays 1s / 5s / 15s, on non-2xx, timeout, or
  connection error.
- 5-second timeout per delivery — return a 2xx fast and do heavy work asynchronously.
- Make handlers **idempotent** keyed on `x-request-network-delivery` (or `requestId`).

## Express handler (raw body)

```javascript
import express from "express";
import crypto from "node:crypto";

const app = express();
app.use(express.raw({ type: "application/json", verify: (req, _r, buf) => { req.rawBody = buf; } }));

app.post("/webhooks/request-network", async (req, res) => {
  const sig = req.headers["x-request-network-signature"];
  const expected = crypto.createHmac("sha256", process.env.RN_WEBHOOK_SECRET)
    .update(req.rawBody).digest("hex");
  if (!sig || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
    return res.status(401).json({ error: "Invalid signature" });

  const body = JSON.parse(req.rawBody.toString("utf8"));
  const deliveryId = req.headers["x-request-network-delivery"];
  // if (await alreadyProcessed(deliveryId)) return res.status(200).json({ ok: true });

  switch (body.event) {
    case "payment.confirmed":
    case "payment.confirmed.checkout":
      // await fulfillOrder({ requestId: body.requestId, reference: body.paymentReference });
      break;
    case "payment.partial": /* update balance */ break;
    case "payment.failed":  /* notify / retry */  break;
    default: /* ignore unknown events gracefully */ break;
  }
  res.status(200).json({ ok: true });
});
```

## Next.js (App Router) handler

```javascript
// app/api/webhooks/request-network/route.ts
import crypto from "node:crypto";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const raw = await request.text();                       // raw body, exact bytes
  const sig = request.headers.get("x-request-network-signature");
  const expected = crypto.createHmac("sha256", process.env.RN_WEBHOOK_SECRET!)
    .update(raw).digest("hex");
  if (!sig || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  const body = JSON.parse(raw);
  // handle body.event ...
  return NextResponse.json({ ok: true }, { status: 200 });
}
```

## Local testing

```bash
ngrok http 3000                          # expose your local server over HTTPS
# register the ngrok URL via POST /v1/webhook, then:
curl -X POST "https://auth.request.network/v1/webhook/test" \
  -H "Content-Type: application/json" -H "x-client-id: $RN_CLIENT_ID" \
  -d '{ "eventType": "payment.confirmed" }'
```

Test deliveries carry `x-request-network-test: true` so handlers can branch on test vs real.

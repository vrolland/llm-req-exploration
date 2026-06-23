# Hosted checkout — Secure Payment Pages

The recommended way to accept Request Network payments on any site. Your backend creates a
secure payment, the API returns a hosted URL on `pay.request.network`, and you redirect the
buyer there. The hosted page handles wallet connection, the official-contract safety check,
optional KYT screening, cross-chain swap-to-pay, and signing. You never touch web3 code.

Base URL: `https://api.request.network/v2`

## Endpoint map

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `POST` | `/v2/secure-payments` | Create an incoming payment link (single, or batch on EVM). |
| `POST` | `/v2/secure-payments/payouts` | Create a hosted outgoing payout link (single recipient). |
| `GET`  | `/v2/secure-payments` | Look up a link by `requestId` (needs a SIWE wallet session). |
| `GET`  | `/v2/secure-payments/:token` | Payment metadata (amounts, status) — not calldata. |
| `GET`  | `/v2/secure-payments/:token/pay` | Executable calldata (used internally by the hosted page). |
| `POST` | `/v2/secure-payments/:token/intent` | Record a cross-chain intent after the source tx. |

For the hosted flow you normally only call **`POST /v2/secure-payments`** and then rely on
webhooks. The `:token/pay` and `:token/intent` endpoints are for building your *own* page
(see `embedded-checkout.md`); the hosted page calls them for you.

## Authentication

Use the **Client ID** (`x-client-id`) — it works server-side on its own and is what the
Dashboard gives you. `POST /v2/secure-payments` also accepts `x-client-id` + `Origin` from
the browser, or the optional `x-api-key` for trusted server environments, or a wallet
session. Prefer `x-client-id` from your backend; examples below use it.

## Create an incoming payment

### Request fields

- `requests` (array, required) — one item = single payment; multiple items = batch (EVM only).
  - `requests[].amount` (string, required) — human-readable, e.g. `"10.50"`, must be > 0.
  - `requests[].destinationId` (string) — ERC-7828 composite `{interopAddress}:{tokenAddress}`.
    Optional when the authenticated Client ID has a bound payee destination (the usual case).
- `feePercentage` (string) — optional, `"0"`–`"100"` (e.g. `"2.5"`). Requires `feeAddress`.
- `feeAddress` (string) — optional fee recipient; required if `feePercentage` is set.
- `reference` (string) — optional merchant reference for reconciliation, ≤255 chars.
- `payerIdentifier` (string) — optional payer identifier, ≤255 chars.
- `redirectUrl` (string) — optional `http(s)` URL rendered as a button on the success
  screen. **No auto-redirect.** Only safe URLs accepted (no `< > " ' \` ` or whitespace).
- `redirectLabel` (string) — optional button label (1–255 chars). Defaults to
  "Go Back and Close". Cannot be set without `redirectUrl` (400 otherwise).

### Example

```bash
curl -X POST "https://api.request.network/v2/secure-payments" \
  -H "x-client-id: $RN_CLIENT_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "requests": [{ "amount": "10" }],
    "reference": "ORDER-2026-001",
    "redirectUrl": "https://merchant.example.com/order/2026-001/thank-you",
    "redirectLabel": "Back to merchant"
  }'
```

### Response (201)

```json
{
  "requestIds": ["01e273ecc29d4b526df3a0f1f05ffc59372af8752c2b678096e49ac270416a7cdb"],
  "securePaymentUrl": "https://pay.request.network/?token=01ABC123DEF456GHI789JKL",
  "token": "01ABC123DEF456GHI789JKL"
}
```

Persist `{ yourReference, requestIds, token }`, then `302`-redirect the buyer to
`securePaymentUrl`. Confirmation arrives via the `payment.confirmed` (or
`payment.confirmed.checkout`) webhook.

### Errors

`400` invalid body / unsupported config (e.g. batch on Tron) · `401` unauthorized ·
`429` rate limited.

## Batch incoming payment (EVM only)

Pass multiple `requests[]` items, each with its own `amount` and (if needed)
`destinationId`. All must be on the same network. Tron rejects batches with a 400:
"Batch payments are not supported for TRON networks."

## Hosted payout (outgoing, single recipient)

Use `POST /v2/secure-payments/payouts` to generate a hosted link *you* (or a payer) open to
sign and broadcast an outgoing payment — handy for paying contractors/vendors without
running web3 yourself.

Fields: `recipient` (required, `0x...` or `T...`), `creatorWalletAddress` (required),
`network` (required: `mainnet`,`arbitrum-one`,`optimism`,`base`,`matic`,`bsc`,`tron`,`sepolia`),
`currency` (required, `<symbol>-<network>` e.g. `USDC-base`, `USDT-tron`), `amount` (required,
human-readable), plus optional `reference`, `recipientIdentifier`, `feePercentage`/`feeAddress`,
`redirectUrl`/`redirectLabel`.

```bash
curl -X POST "https://api.request.network/v2/secure-payments/payouts" \
  -H "x-client-id: $RN_CLIENT_ID" -H "Content-Type: application/json" \
  -d '{
    "recipient": "0x6923831ACf5c327260D7ac7C9DfF5b1c3cB3C7D7",
    "creatorWalletAddress": "0x2e2E5C79F571ef1658d4C2d3684a1FE97DD30570",
    "network": "base", "currency": "USDC-base", "amount": "250",
    "reference": "INVOICE-2026-042"
  }'
```

Response shape matches the incoming case: `{ requestIds, securePaymentUrl, token }`.

## What the hosted page does for you

- **Contract safety check** — validates the tx targets official, audited Request Network
  contracts and warns/blocks otherwise.
- **KYT wallet screening** — enforced when the destination has a compliance gate enabled.
- **Cross-chain swap-to-pay** — payer can pay from another chain/token (USDC/USDT across
  Ethereum, Arbitrum, Base, Optimism, Polygon), routed via Li.Fi.
- **Smart-account / gas-sponsored payments** — optional gasless flow via Safe + Pimlico on
  supported chains.

## Status outcomes for a token

`200` valid & payable · `403` expired or not payable · `404` not found ·
`409` already completed.

## Framework-agnostic pattern (Django / Rails / PHP / serverless)

The hosted flow is just two server-side steps in any language:

1. `POST https://api.request.network/v2/secure-payments` with header `x-client-id` and a JSON
   body `{ "requests": [{ "amount": "<total>" }], "reference": "<order id>",
   "redirectUrl": "<your thank-you URL>" }`. Read `securePaymentUrl` from the JSON response.
2. Redirect the user (HTTP 302) to `securePaymentUrl`. Save `requestIds`/`reference` in your DB.

Then expose one webhook route (see `webhooks.md`) that flips the order to "paid" on
`payment.confirmed`. That's the entire integration — no SDK, no web3 library required.

### Node / Express route

```javascript
import express from "express";
const app = express();
app.use(express.json());

app.post("/checkout", async (req, res) => {
  const { amount, orderId } = req.body;
  const r = await fetch(`${process.env.RN_API_BASE}/secure-payments`, {
    method: "POST",
    headers: { "x-client-id": process.env.RN_CLIENT_ID, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{ amount: String(amount) }],
      reference: orderId,
      redirectUrl: `https://yoursite.com/orders/${orderId}/thank-you`,
    }),
  });
  if (!r.ok) return res.status(502).json({ error: await r.text() });
  const { securePaymentUrl, requestIds } = await r.json();
  // await db.orders.update(orderId, { requestIds, status: "awaiting_payment" });
  res.json({ redirectUrl: securePaymentUrl });
});
```

### Next.js (App Router) route handler

```javascript
// app/api/checkout/route.ts
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { amount, orderId } = await request.json();
  const r = await fetch(`${process.env.RN_API_BASE}/secure-payments`, {
    method: "POST",
    headers: { "x-client-id": process.env.RN_CLIENT_ID!, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{ amount: String(amount) }],
      reference: orderId,
      redirectUrl: `https://yoursite.com/orders/${orderId}/thank-you`,
    }),
  });
  if (!r.ok) return NextResponse.json({ error: await r.text() }, { status: 502 });
  const { securePaymentUrl } = await r.json();
  return NextResponse.json({ redirectUrl: securePaymentUrl });
}
```

Front-end then just does `window.location.href = redirectUrl`.

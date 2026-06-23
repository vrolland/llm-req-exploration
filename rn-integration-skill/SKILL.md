---
name: request-network-integration
description: >-
  Integrate Request Network crypto/stablecoin payments into any website or web app.
  Use this whenever the user wants to accept crypto payments, add a web3 / blockchain
  checkout, build a stablecoin (USDC/USDT) payment flow, generate hosted payment links,
  send crypto payouts, or reconcile on-chain payments via webhooks — and especially any
  time "Request Network", "request.network", "api.request.network", "secure payment page",
  "pay.request.network", or "Client ID + payment destination" is mentioned. Triggers even
  when the user only describes the goal ("let customers pay me in USDC on my site",
  "add a crypto checkout to my Shopify/Next.js/Django app") without naming the product.
  Covers credential setup, the hosted Secure Payment Page flow, the embedded wallet flow,
  webhook reconciliation, supported chains/currencies, and security rules.
---

# Request Network integration

Request Network is a payment protocol for getting paid and paying in crypto and
stablecoins across EVM chains and Tron, without intermediaries. This skill helps you
wire it into any website — any backend stack (Node, Next.js, Django, Rails, PHP,
serverless) and any frontend.

## First: pick the integration path

There are two ways to take a payment. Choose based on how much frontend/web3 work the
user wants to own.

**Hosted Secure Payment Page (recommended default).** Your backend calls
`POST /v2/secure-payments`, gets back a `securePaymentUrl` on `pay.request.network`, and
you redirect the buyer there. The hosted page handles wallet connection, the contract
safety check, cross-chain swap-to-pay, and signing. You get paid; a webhook tells you
when it's confirmed. **No web3 code on your site.** This works with literally any stack,
including static sites backed by a single serverless function. Use this unless the user
specifically wants an in-page wallet experience. Full details: `references/hosted-checkout.md`.

**Embedded wallet flow.** Your backend asks the API for raw transaction calldata
(`POST /v2/payouts` or the request + `/pay` endpoints), and your frontend connects the
buyer's wallet (wagmi/viem, ethers, TronLink) and submits the transactions itself. More
control over UX, but you own wallet connection, chain switching, approvals, and error
handling. Use only when the user wants payments to happen inside their own UI. Full
details: `references/embedded-checkout.md`.

Both paths use the **same webhook system** for reconciliation — always set that up too
(`references/webhooks.md`). Webhooks are how you reliably learn a payment settled;
never trust only a frontend "success" callback.

If the user is unsure, default to the hosted page and mention the embedded option exists.

## Step 1 — Credentials

**The Client ID is the primary credential.** It's the thing the Dashboard generates, and
every official tutorial uses it — including for server-side calls and for registering
webhooks. Don't go looking for a separate "API key" in the Dashboard; the Client ID is it.

- **Client ID** (`x-client-id` header) — the main credential. Use it both:
  - **server-side** (backend, serverless, cron): send `x-client-id: <CLIENT_ID>` alone.
    This is what the official `/payouts`, `/secure-payments`, and webhook examples do.
  - **browser-side**: send `x-client-id: <CLIENT_ID>` plus the `Origin` header (browsers add
    `Origin` automatically). The Client ID is restricted to the domains you whitelist on it,
    which is what makes it safe to expose to the front-end.
- **API key** (`x-api-key` header) — an *optional alternative* for trusted server
  environments. It is a distinct secret (not produced by the "Generate Client ID" button) and
  **must never be exposed to the browser**. Most integrations don't need it; use the Client ID.

Get a Client ID from the [Dashboard](https://dashboard.request.network) after signing in
with a wallet. Important ordering gotcha: **you must create a payment destination first**
(Home → "Set up payment destination", pick chain + token to receive on); the Client IDs
section only appears once a destination exists. Then Manage Destination → Client IDs →
Generate.

Store credentials in environment variables, never in version control:

```bash
# .env
RN_API_BASE=https://api.request.network/v2
RN_AUTH_BASE=https://auth.request.network/v1
RN_CLIENT_ID=your_client_id_here          # primary credential (x-client-id)
RN_WEBHOOK_SECRET=set_after_registering_webhook
# RN_API_KEY=optional_server_only_key     # only if you opt into x-api-key auth — never expose
```

When the user hasn't created credentials yet, walk them through the Dashboard steps above
before writing integration code — the code is useless without a Client ID and a payment
destination.

## Step 2 — Create a payment (hosted path)

The minimal server-side call. The `destinationId` can be omitted when the authenticated
Client ID already has a bound payee destination (the common case after Dashboard setup);
include it explicitly for multi-destination setups.

```javascript
// POST to your own backend route, which calls Request Network server-side
const res = await fetch(`${process.env.RN_API_BASE}/secure-payments`, {
  method: "POST",
  headers: {
    "x-client-id": process.env.RN_CLIENT_ID,   // primary credential, server-side
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    requests: [{ amount: "25.00" }],           // human-readable amount, as a string
    reference: "ORDER-2026-001",               // your order id, for reconciliation
    redirectUrl: "https://yoursite.com/thank-you",
    redirectLabel: "Back to store",
  }),
});
const { securePaymentUrl, token, requestIds } = await res.json();
// Redirect the buyer to securePaymentUrl; persist { reference, requestIds, token }.
```

Key facts that trip people up:

- `amount` is **human-readable string** (`"25.00"`), not wei/BigNumber. The API handles decimals.
- There is **no auto-redirect** after payment. `redirectUrl` only renders a button on the
  success screen; reconciliation must come from webhooks.
- Persist your `reference` ↔ `requestIds` mapping now, so the webhook can match later.
- Optional platform fee: add `feePercentage` (`"2.5"`) **and** `feeAddress` together.

## Step 3 — Reconcile with webhooks (do this every time)

Register one webhook per Client ID; it receives events for everything that Client ID
creates. Registration returns a signing `secret` shown **once**.

```bash
curl -X POST "$RN_AUTH_BASE/webhook" \
  -H "Content-Type: application/json" \
  -H "x-client-id: $RN_CLIENT_ID" \
  -d '{ "url": "https://yoursite.com/webhooks/request-network" }'
# => { "id": "...", "secret": "STORE_THIS_AS_RN_WEBHOOK_SECRET" }
```

Your handler must verify the HMAC-SHA256 signature against the **raw request body** before
parsing, then act on `event === "payment.confirmed"`. Full handler code (Express,
Next.js, raw-body gotchas, every event type, idempotency, retry behavior) is in
`references/webhooks.md`. Use the ready-made handler in `assets/webhook-handler.js` as a
starting point.

For local testing, expose your server with ngrok and fire a test delivery:
```bash
curl -X POST "$RN_AUTH_BASE/webhook/test" \
  -H "Content-Type: application/json" -H "x-client-id: $RN_CLIENT_ID" \
  -d '{ "eventType": "payment.confirmed" }'
```

## Networks & currencies (quick reference)

8 networks: 7 EVM + Tron. Currency IDs use `<symbol>-<network>` form. Common ones:

- Mainnet EVM: `USDC-mainnet`, `USDC-base`, `USDC-arbitrum-one`, `USDT-optimism`,
  `USDC-matic`, `USDT-bsc`, `ETH-mainnet`
- Tron (TRC-20, `T...` addresses): `USDT-tron`, `USDC-tron`
- Testnet (Sepolia): `FAU-sepolia`, `USDC-sepolia`, `ETH-sepolia-sepolia`

Batch payments (paying many recipients in one transaction) are **EVM-only** — Tron batch
requests are rejected. Cross-chain swap-to-pay (USDC/USDT via Li.Fi) is EVM-source only.
Full matrix and the currencies-discovery endpoints: `references/api-reference.md`.

## Security rules (always apply)

- The Client ID is the credential to use. Server-side, send `x-client-id` alone; in the
  browser, send `x-client-id` + `Origin` with the domain whitelist configured. If you opt
  into the alternative `x-api-key`, keep it server-side only — never ship it to the client.
- Verify every webhook's signature against the **raw** body using the per-webhook secret.
  Reject on mismatch. Never act on an unverified webhook.
- Treat the buyer's frontend "success" as a hint, not proof. Fulfillment keys off the
  `payment.confirmed` webhook.
- Use HTTPS for webhook endpoints in production. Return a 2xx quickly (5s timeout, retries
  at 1s/5s/15s); do heavy work async and make handlers idempotent on the delivery ID.

## Reference files

Read the one that matches the task; don't load all of them.

- `references/hosted-checkout.md` — Secure Payment Pages end-to-end: request/response
  schemas, batch payments, cross-chain, hosted payouts, framework examples (Node/Express,
  Next.js, plus a framework-agnostic pattern for Django/Rails/PHP).
- `references/embedded-checkout.md` — In-page wallet flow: getting calldata, executing
  transactions with wagmi/viem, approvals, status polling, the React example.
- `references/webhooks.md` — Webhook registration/management, signature verification,
  the full event catalog and payloads, retry/idempotency, Express & Next.js handlers.
- `references/api-reference.md` — Auth, endpoint index, supported networks/currencies,
  error codes, and the currencies discovery API.

## Reusable assets

- `assets/webhook-handler.js` — Express webhook handler with raw-body signature
  verification and an event switch, ready to drop in.
- `assets/create-secure-payment.js` — Framework-agnostic helper to create a hosted
  payment link and return `securePaymentUrl`.

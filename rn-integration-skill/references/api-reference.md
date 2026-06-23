# API reference cheat sheet

Base URLs:
- Payments API: `https://api.request.network/v2`
- Auth API (Client IDs context, webhooks): `https://auth.request.network/v1`
- Hosted payer app: `https://pay.request.network`
- Dashboard: `https://dashboard.request.network`
- Explorer: `https://scan.request.network`

## Authentication

| Credential | Header(s) | Use for |
| ---------- | --------- | ------- |
| **Client ID** (primary) | `x-client-id` (server) · `x-client-id` + `Origin` (browser) | The credential the Dashboard generates. Works server-side on its own; in the browser it needs `Origin` and is domain-whitelisted. Used by every official tutorial, including server calls and webhook registration. |
| API key (optional) | `x-api-key` | Alternative for trusted server environments. A distinct secret, not the "Generate Client ID" output. Never expose to the browser. |

The Client ID is what you actually create in the Dashboard — there is no separate "API key"
button. Use `x-client-id` everywhere unless you deliberately opt into `x-api-key` server-side.
Get credentials from the Dashboard — create a **payment destination first**, then generate a
Client ID under Manage Destination.

Common auth errors: `401` missing/invalid credential · `403` valid but not allowed / Client
ID revoked or restricted · `429` rate limited.

## Endpoint index (v2)

Secure payments (hosted + self-rendered):
- `POST /v2/secure-payments` — create incoming link (single, or batch on EVM).
- `POST /v2/secure-payments/payouts` — create hosted outgoing payout link.
- `GET /v2/secure-payments?requestId=…` — look up by request id (SIWE session).
- `GET /v2/secure-payments/:token` — metadata/status.
- `GET /v2/secure-payments/:token/pay` — executable calldata.
- `POST /v2/secure-payments/:token/intent` — record cross-chain source tx.

Direct payments / requests (embedded):
- `POST /v2/payouts` — create payout, returns ready-to-execute calldata.
- `POST /v2/request` — create a payment request (invoice).
- `GET /v2/request/:requestId` — request status.
- `GET /v2/request/:requestId/pay` — calldata to pay a request.
- `GET /v2/request/:requestId/routes` — available payment routes (per-wallet balances).
- `POST /v2/pay` — initiate a payment (incl. recurring) without creating a request first.

Discovery & data:
- `GET /v2/currencies` — list/filter currencies (`?network=…&symbol=…&firstOnly=true`).
- `GET /v2/currencies/:currencyId/conversion-routes` — payment currencies for an invoice currency.
- `GET /v2/payments` — advanced payment search (txHash, wallet, reference, requestId, …).

Webhooks (Auth API): `POST/GET/PUT/DELETE /v1/webhook`, `POST /v1/webhook/test` — see
`webhooks.md`.

Full interactive spec: `https://api.request.network/open-api` and OpenAPI JSON at
`https://docs.request.network/api-reference/openapi.v2.json`.

## Supported networks (8: 7 EVM + Tron)

| Network | Network ID | Chain ID | USDC | USDT |
| ------- | ---------- | -------- | ---- | ---- |
| Ethereum | `mainnet` | 1 | ✓ | ✓ |
| Arbitrum One | `arbitrum-one` | 42161 | ✓ | ✓ (also USDT0) |
| Optimism | `optimism` | 10 | ✓ | ✓ |
| Base | `base` | 8453 | ✓ | ✓ |
| Polygon | `matic` | 137 | ✓ | ✓ |
| BNB Smart Chain | `bsc` | 56 | ✓ | ✓ |
| Tron | `tron` | 728126428 | ✓ | ✓ |
| Sepolia (testnet) | `sepolia` | 11155111 | FAU, USDC, USDT | |

Feature support: single incoming/outgoing, conversion payments, cross-chain swap-to-pay
(Li.Fi), and recurring work on both EVM and Tron. **Batch incoming/outgoing payments are
EVM-only** — Tron batches return 400. Cross-chain swap-to-pay sources are EVM-only.

Tron notes: mainnet only (no Tron testnet), TRC-20 tokens, Base58 `T…` addresses; native
TRX pays energy/bandwidth. USDT `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`,
USDC `TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8`.

## Currency IDs

Form: `<symbol>-<network>`. Examples:

```
ETH-mainnet      USDC-mainnet     USDC-base        USDT-arbitrum-one
USDT0-arbitrum-one                USDC-matic       USDT-bsc
USDT-tron        USDC-tron
FAU-sepolia      USDC-sepolia     ETH-sepolia-sepolia
```

Conversion (fiat-denominated) payments: invoice currencies include `USD`, `EUR`, `GBP`,
`CNY`, `JPY`; payment currencies include `USDC`, `USDT`, `DAI`, `FAU` (Sepolia). Use
`GET /v2/currencies/:id/conversion-routes` to list valid payment currencies for an invoice
currency. The full ERC20/native catalog is 500+ tokens (Request Network Token List); for
destinations and secure links, stick to the 8 canonical networks above.

## Amounts

All amounts are **human-readable strings** (e.g. `"25.00"`). No wei/BigNumber conversions —
the API maps to token decimals for you. Calldata `value` may come back as
`{ "type": "BigNumber", "hex": "0x…" }`; convert with `BigInt(value.hex)` when submitting.

## Standard response objects

Calldata transaction: `{ to, data, value }` (`value` may be BigNumber-shaped or `0`).
Calldata metadata: `{ stepsRequired, needsApproval, paymentTransactionIndex,
approvalTransactionIndex?, hasEnoughBalance?, hasEnoughGas?, routeType?, quoteExpiresAt? }`.
Secure-payment create: `{ requestIds, securePaymentUrl, token }`.

## Common HTTP errors

`400` bad/invalid body (check required fields, amount as string, valid currency/network,
no Tron batch) · `401` unauthorized (header name/value, revoked credential) · `403`
forbidden / token expired or not payable · `404` not found · `409` already completed ·
`429` rate limited.

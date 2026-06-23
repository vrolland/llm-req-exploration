# Embedded checkout — in-page wallet flow

Use this when the user wants payments to happen inside their own UI instead of redirecting
to `pay.request.network`. You own wallet connection, chain switching, ERC20 approvals, and
error handling. More work than the hosted page — only choose it when the in-page experience
is a real requirement.

Two sub-patterns:

1. **Payout-style calldata** (`POST /v2/payouts`): simplest. Send payee + amount, get back
   ready-to-execute `transactions[]`, submit them from the connected wallet. Good for
   "send/pay this address now" flows.
2. **Request + secure-payment calldata** (`POST /v2/secure-payments` then
   `GET /v2/secure-payments/:token/pay`): create the payment record, then fetch calldata for
   a specific payer wallet and (optionally) a cross-chain source route. Good when you want
   the same record/webhooks as the hosted flow but render the pay button yourself.

Always pair with webhooks for truth-of-record (`webhooks.md`).

## Pattern 1 — payouts calldata

### Backend creates calldata

```javascript
const r = await fetch(`${process.env.RN_API_BASE}/payouts`, {
  method: "POST",
  headers: { "x-client-id": process.env.RN_CLIENT_ID, "Content-Type": "application/json" },
  body: JSON.stringify({
    payee: "0xRecipient...",
    amount: "0.2",                          // human-readable string
    invoiceCurrency: "ETH-sepolia-sepolia", // what the amount is denominated in
    paymentCurrency: "ETH-sepolia-sepolia", // what the payer actually pays in
  }),
});
const data = await r.json();
// data = { requestId, paymentReference, transactions: [...], metadata: {...} }
```

Response:

```json
{
  "requestId": "011d9f76e07a678b8321ccfaa300efd4d80832652b8bbc07ea4069ca71006210b5",
  "paymentReference": "0xe23a6b02059c2b30",
  "transactions": [
    { "data": "0xb868980b...", "to": "0xe11BF2fDA23bF0A98365e1A4c04A87C9339e8687",
      "value": { "type": "BigNumber", "hex": "0x02c68af0bb140000" } }
  ],
  "metadata": { "stepsRequired": 1, "needsApproval": false, "paymentTransactionIndex": 0 }
}
```

Send `transactions` (and `requestId`) to the frontend. **Keep your server credential
(`x-client-id`, or `x-api-key` if you use it) on the backend** — calldata is generated
server-side and only the transaction array crosses to the client. Note `metadata.needsApproval` / `stepsRequired`: an ERC20 payment may return an
approval tx *before* the payment tx — execute them in order.

### Frontend executes with wagmi/viem

```tsx
import { useSendTransaction, useAccount } from "wagmi";

function PayButton({ transactions, requestId }) {
  const { isConnected } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();

  async function pay() {
    if (!isConnected) return alert("Connect your wallet first");
    for (const tx of transactions) {           // approval (if any) then payment, in order
      await sendTransactionAsync({
        to: tx.to,
        data: tx.data,
        value: BigInt(tx.value.hex ?? tx.value ?? 0),
      });
    }
    // Optimistically mark in-progress; rely on the webhook for "confirmed".
  }
  return <button disabled={!isConnected} onClick={pay}>Pay</button>;
}
```

Minimal wagmi config (injected wallet, e.g. MetaMask):

```typescript
import { createConfig, http } from "wagmi";
import { mainnet, base, arbitrum, optimism, polygon, sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const config = createConfig({
  chains: [mainnet, base, arbitrum, optimism, polygon, sepolia],
  connectors: [injected()],
  transports: {
    [mainnet.id]: http(), [base.id]: http(), [arbitrum.id]: http(),
    [optimism.id]: http(), [polygon.id]: http(), [sepolia.id]: http(),
  },
});
```

Wrap the app in `WagmiProvider` + `QueryClientProvider` (`@tanstack/react-query`). For Tron,
use TronLink instead of wagmi; the calldata is Tron-native and single-recipient/same-chain.

## Pattern 2 — secure-payment calldata (self-rendered, same record as hosted)

1. Create the payment: `POST /v2/secure-payments` (see `hosted-checkout.md`) → get `token`.
2. Fetch metadata for display: `GET /v2/secure-payments/:token?wallet=<payer>` → amounts,
   status, and `paymentOptions` (per-chain balances) when `wallet` is supplied.
3. Fetch executable calldata: `GET /v2/secure-payments/:token/pay?wallet=<payer>`.
   - Same-chain → returns `{ transactions: [...], metadata: {...} }`.
   - Cross-chain → add `&chain=<SRC>&token=<USDC|USDT>` (sources: `BASE`, `OPTIMISM`,
     `ARBITRUM`, `ETHEREUM`, `POLYGON`, `BNB`). Returns approval + bridge txs and a
     `quoteExpiresAt`. After the payer broadcasts the source tx, record it with
     `POST /v2/secure-payments/:token/intent` `{ txHash, chain, token }` so the bridge is
     tracked and destination-chain detection fires.
   - Batch → returns `ERC20ApprovalTransactions[]` + a single `batchPaymentTransaction`.

> Path `:token` is the secure-payment ULID. The `token` *query* param is the source
> currency symbol (`USDC`/`USDT`) for cross-chain selection — different things.

`/pay` errors: `400` invalid/unsupported cross-chain · `403` expired/not payable ·
`404` not found · `409` already completed · `429` rate limited.

## Gotchas

- Amounts are human-readable strings everywhere; no manual decimals/wei math.
- Execute multi-step transaction sets **in array order** (approval before payment).
- Cross-chain quotes expire (`quoteExpiresAt`) — refetch `/pay` if the payer stalls.
- Frontend success ≠ settled. Fulfillment is driven by the `payment.confirmed` webhook.

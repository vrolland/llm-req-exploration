// Create a hosted Request Network payment link (Secure Payment Page).
//
// Framework-agnostic: works in any Node backend / serverless function. Call it from a
// server route, then redirect the buyer to the returned securePaymentUrl.
//
//   import { createSecurePayment } from "./create-secure-payment.js";
//   const { securePaymentUrl, requestIds } = await createSecurePayment({
//     amount: "25.00", reference: orderId, redirectUrl: `https://site.com/orders/${orderId}/done`,
//   });
//   res.redirect(securePaymentUrl);
//
// Requires env: RN_API_BASE (default https://api.request.network/v2) and RN_CLIENT_ID.
// RN_CLIENT_ID is the credential the Dashboard generates; it authenticates server-side
// calls via the x-client-id header. (Optionally pass an apiKey to use x-api-key instead.)

const API_BASE = process.env.RN_API_BASE || "https://api.request.network/v2";

/**
 * @param {object} opts
 * @param {string}   opts.amount         Human-readable amount as a string, e.g. "25.00".
 * @param {string}  [opts.destinationId] ERC-7828 "{interopAddress}:{tokenAddress}". Optional
 *                                       when the Client ID has a bound payee destination.
 * @param {string}  [opts.reference]     Your order id / merchant reference (<=255 chars).
 * @param {string}  [opts.payerIdentifier]
 * @param {string}  [opts.redirectUrl]   http(s) URL shown as a button on success (no auto-redirect).
 * @param {string}  [opts.redirectLabel] Button label; requires redirectUrl.
 * @param {string}  [opts.feePercentage] "0".."100"; requires feeAddress.
 * @param {string}  [opts.feeAddress]    Fee recipient; required if feePercentage set.
 * @param {string}  [opts.clientId]      Override RN_CLIENT_ID (sent as x-client-id).
 * @param {string}  [opts.apiKey]        Use x-api-key auth instead of the Client ID.
 * @returns {Promise<{ requestIds: string[], securePaymentUrl: string, token: string }>}
 */
export async function createSecurePayment(opts) {
  const {
    amount,
    destinationId,
    reference,
    payerIdentifier,
    redirectUrl,
    redirectLabel,
    feePercentage,
    feeAddress,
    clientId = process.env.RN_CLIENT_ID,
    apiKey,
  } = opts;

  if (!amount) throw new Error("amount is required (human-readable string, e.g. '25.00')");
  if (!apiKey && !clientId) throw new Error("Set RN_CLIENT_ID (or pass apiKey) for auth");
  if (feePercentage && !feeAddress) throw new Error("feeAddress is required when feePercentage is set");
  if (redirectLabel && !redirectUrl) throw new Error("redirectLabel requires redirectUrl");

  const request = { amount: String(amount) };
  if (destinationId) request.destinationId = destinationId;

  const body = { requests: [request] };
  if (reference) body.reference = reference;
  if (payerIdentifier) body.payerIdentifier = payerIdentifier;
  if (redirectUrl) body.redirectUrl = redirectUrl;
  if (redirectLabel) body.redirectLabel = redirectLabel;
  if (feePercentage) body.feePercentage = String(feePercentage);
  if (feeAddress) body.feeAddress = feeAddress;

  const authHeaders = apiKey ? { "x-api-key": apiKey } : { "x-client-id": clientId };
  const res = await fetch(`${API_BASE}/secure-payments`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Request Network API ${res.status}: ${detail}`);
  }
  return res.json(); // { requestIds, securePaymentUrl, token }
}

/**
 * Oxy Pay payment-request deep link — parser + contract.
 *
 * A merchant/Gateway hands the payer an `oxypay://pay?...` link (QR or button)
 * that fully describes one payment intent:
 *
 *   oxypay://pay?intent=<pi_...>&secret=<client_secret>&address=<addr>
 *               &amount=<base_units>&network=<mainnet|testnet>
 *
 * `parsePaymentRequest` turns that URL into a validated {@link ParsedPaymentRequest}
 * or returns `null` for anything malformed — so the deep-link router only ever
 * pushes the approve screen for a well-formed, self-consistent request. The
 * approve screen re-derives the same values from its route params and pays the
 * `address` for `amount`, then reports the txid to the Gateway with `intentId` +
 * `clientSecret` (possession of the secret is the payer's authorization).
 */

import { getNetwork, validateAddress, type NetworkType } from '@fairco.in/core';

/** The `oxypay://pay` deep-link scheme + host that carries a payment request. */
const PAYMENT_REQUEST_PREFIX = 'oxypay://pay';

/** A fully validated, self-consistent Oxy Pay payment request. */
export interface ParsedPaymentRequest {
  /** Payment intent id (`pi_<hex>`). */
  intentId: string;
  /** The intent's client secret — the payer's proof of possession. */
  clientSecret: string;
  /** FairCoin receive address to pay (validated for `network`). */
  address: string;
  /** Amount to pay, in base units (m⊜). Always positive. */
  amount: bigint;
  /** Chain the payment must settle on. */
  network: NetworkType;
}

/** `pi_` followed by lowercase hex — the Gateway's payment-intent id format. */
const INTENT_ID_PATTERN = /^pi_[0-9a-f]{24,}$/;

function isNetworkType(value: string): value is NetworkType {
  return value === 'mainnet' || value === 'testnet';
}

/**
 * Split the query string of an `oxypay://pay` URL into a key→value map. Values
 * are percent-decoded; a malformed escape (which makes `decodeURIComponent`
 * throw) surfaces as `null` so the caller rejects the whole request.
 */
function parseQuery(query: string): Map<string, string> | null {
  const params = new Map<string, string>();
  if (query.length === 0) {
    return params;
  }
  try {
    for (const pair of query.split('&')) {
      if (pair.length === 0) {
        continue;
      }
      const eq = pair.indexOf('=');
      const rawKey = eq === -1 ? pair : pair.slice(0, eq);
      const rawValue = eq === -1 ? '' : pair.slice(eq + 1);
      params.set(decodeURIComponent(rawKey), decodeURIComponent(rawValue));
    }
  } catch {
    // A malformed percent-escape means the link is corrupt — reject it whole
    // rather than acting on partially-decoded payment fields.
    return null;
  }
  return params;
}

/**
 * Parse and fully validate an `oxypay://pay?...` deep link.
 *
 * Returns `null` unless every field is present and self-consistent: the scheme
 * matches, `intent` looks like a `pi_` id, `secret` belongs to that intent,
 * `network` is a known chain, `address` is a valid FairCoin address on that
 * chain, and `amount` is a positive base-unit integer.
 */
export function parsePaymentRequest(uri: string): ParsedPaymentRequest | null {
  const trimmed = uri.trim();
  if (!trimmed.startsWith(PAYMENT_REQUEST_PREFIX)) {
    return null;
  }

  const rest = trimmed.slice(PAYMENT_REQUEST_PREFIX.length);
  // Only the bare host or a `?query` may follow — guard against `oxypay://payX`.
  if (rest.length > 0 && !rest.startsWith('?')) {
    return null;
  }
  const query = rest.startsWith('?') ? rest.slice(1) : '';

  const params = parseQuery(query);
  if (!params) {
    return null;
  }

  const intentId = params.get('intent') ?? '';
  const clientSecret = params.get('secret') ?? '';
  const address = params.get('address') ?? '';
  const amountRaw = params.get('amount') ?? '';
  const networkRaw = params.get('network') ?? '';

  if (!INTENT_ID_PATTERN.test(intentId)) {
    return null;
  }

  // The client secret is minted as `${intentId}_secret_<hex>`; tying it back to
  // the intent id rejects a mismatched (mis-pasted / spoofed) id/secret pair.
  if (!clientSecret.startsWith(`${intentId}_secret_`)) {
    return null;
  }

  if (!isNetworkType(networkRaw)) {
    return null;
  }
  const network = networkRaw;

  if (!validateAddress(address, getNetwork(network))) {
    return null;
  }

  // Amount is a base-unit integer string (never a float). Reject anything with a
  // sign, decimal point, or non-digit, and require a strictly positive value.
  if (!/^\d+$/.test(amountRaw)) {
    return null;
  }
  const amount = BigInt(amountRaw);
  if (amount <= 0n) {
    return null;
  }

  return { intentId, clientSecret, address, amount, network };
}

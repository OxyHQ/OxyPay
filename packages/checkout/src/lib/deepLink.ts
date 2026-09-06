// Builds the `peable://pay?...` deep link the Peable wallet's
// `parsePaymentRequest` parses (packages/frontend/src/pay/payment-request.ts).
// Param names and encoding MUST match that parser exactly — a mismatch means
// the wallet silently rejects the link. Verified against the wallet's REAL
// parser (not a re-reading of it) in `deepLink.test.ts`.
//
// Built by hand rather than `URLSearchParams` deliberately: `URLSearchParams`
// encodes a space as `+` (application/x-www-form-urlencoded), but the
// wallet's parser decodes every value with a plain `decodeURIComponent`
// (which reads `+` literally, not as a space) — `encodeURIComponent` is its
// exact inverse, `URLSearchParams`'s encoding is not.
import type { NetworkType } from '@peable.to/shared-types';

export interface PayDeepLinkParams {
  intentId: string;
  clientSecret: string;
  address: string;
  /** Base-unit integer string (never a float) — same representation as `PaymentIntent.amount`. */
  amount: string;
  network: NetworkType;
}

export function buildPayDeepLink(params: PayDeepLinkParams): string {
  const query = (
    [
      ['intent', params.intentId],
      ['secret', params.clientSecret],
      ['address', params.address],
      ['amount', params.amount],
      ['network', params.network],
    ] as const
  )
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return `peable://pay?${query}`;
}

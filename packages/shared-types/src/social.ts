// Social-receive + transaction-enrichment contracts — shared by the Oxy Pay
// Gateway backend, the wallet frontend, and (indirectly) the enrichment
// service's callers. Mirrors the Stripe-parity style of paymentIntent.ts.

/** Response of `POST /v1/social/:username/next_address` (spec §4.4 step 3). */
export interface SocialNextAddressResponse {
  address: string;
  index: number;
}

/** Where a transaction's counterparty identity came from (spec §4.8). */
export type EnrichmentKind = 'merchant' | 'user' | 'unknown';

/**
 * Display-only counterparty identity for one address/txid, resolved by
 * `POST /v1/enrich`. Never affects custody; a failed/partial resolution
 * degrades to `{ kind: 'unknown' }`.
 */
export interface EnrichmentResult {
  kind: EnrichmentKind;
  /** Merchant name or user's `name.displayName ?? handle`. */
  displayName?: string;
  /** Bare Oxy file id — render via the canonical media chokepoint, never a URL. */
  avatarFileId?: string;
  /** Present for `kind: 'user'` only. */
  username?: string;
  /** Present for `kind: 'merchant'` only. */
  description?: string;
}

export interface EnrichRequest {
  addresses: string[];
}

export interface EnrichResponse {
  data: Record<string, EnrichmentResult>;
}

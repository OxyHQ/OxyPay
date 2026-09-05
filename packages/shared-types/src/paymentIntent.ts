// The PaymentIntent contract — the single source of truth shared by the Peable
// Gateway backend, SDK, and frontend. Mirrors Stripe's PaymentIntent shape over
// the non-custodial FairCoin lifecycle.
import type { NetworkType } from './network';

export type PaymentIntentStatus =
  | 'created'
  | 'awaiting_approval'
  | 'approved'
  | 'broadcast'
  | 'confirming'
  | 'settled'
  | 'expired'
  | 'failed'
  | 'rejected';

/**
 * Legal forward transitions of the PaymentIntent lifecycle. Terminal states
 * (settled/expired/failed/rejected) allow no further transition here — the one
 * documented exception, a reorg dropping `settled` back to `confirming`, is
 * modelled by the backend state machine, not this happy-path table.
 */
const ALLOWED: Record<PaymentIntentStatus, readonly PaymentIntentStatus[]> = {
  // `created` supports two paths: the rich wallet flow (→ awaiting_approval →
  // approved → broadcast) AND the minimal path where the payer pays out-of-band
  // and reports the txid directly (→ broadcast), or the merchant cancels an
  // unpaid intent (→ rejected). Both are legal forward transitions.
  created: ['awaiting_approval', 'broadcast', 'rejected', 'expired'],
  awaiting_approval: ['approved', 'rejected', 'expired'],
  approved: ['broadcast', 'failed'],
  broadcast: ['confirming', 'failed'],
  confirming: ['settled', 'failed'],
  settled: [],
  expired: [],
  failed: [],
  rejected: [],
};

export function isValidStatusTransition(
  from: PaymentIntentStatus,
  to: PaymentIntentStatus,
): boolean {
  return ALLOWED[from].includes(to);
}

/** Every legal `PaymentIntentStatus`, derived from `ALLOWED`'s keys — the
 * single source of truth consumed by the Gateway's list-route status filter. */
export const PAYMENT_INTENT_STATUSES: readonly PaymentIntentStatus[] = Object.keys(
  ALLOWED,
) as PaymentIntentStatus[];

export interface PaymentIntent {
  id: string;
  object: 'payment_intent';
  status: PaymentIntentStatus;
  /** Amount in base units (m⊜) as a canonical integer string. Never a float. */
  amount: string;
  currency: 'FAIR';
  network: NetworkType;
  /** Watch-only receive address derived per-intent from the merchant xpub. */
  address: string;
  merchantId: string;
  txid: string | null;
  confirmations: number;
  clientSecret: string;
  metadata: Record<string, string>;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePaymentIntentParams {
  /** Amount in base units (m⊜) as a canonical integer string. */
  amount: string;
  network: NetworkType;
  metadata?: Record<string, string>;
  expiresInSeconds?: number;
}

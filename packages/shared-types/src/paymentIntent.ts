// The PaymentIntent contract — the single source of truth shared by the Peable
// Gateway backend, SDK, and frontend. Mirrors Stripe's PaymentIntent shape over
// two rails: the non-custodial FairCoin lifecycle, and a fiat card payment
// served by a provider behind the gateway (ADR 0001).
import type { CurrencyCode } from './money';
import type { NetworkType } from './network';

/**
 * Which rail moves the money (ADR 0001 D1).
 *
 * On the INTENT, not on the merchant: one merchant takes both, and a merchant's
 * capabilities are a different question from what this particular payment is.
 * The rail decides which of the fields below mean anything.
 */
export type PaymentIntentRail = 'faircoin' | 'card';

/** {@link PaymentIntentRail} as the tuple the database CHECK reads. */
export const PAYMENT_INTENT_RAILS: readonly PaymentIntentRail[] = ['faircoin', 'card'];

export type PaymentIntentStatus =
  | 'created'
  | 'awaiting_approval'
  | 'approved'
  | 'broadcast'
  | 'confirming'
  | 'requires_action'
  | 'processing'
  | 'settled'
  | 'refunded'
  | 'partially_refunded'
  | 'expired'
  | 'failed'
  | 'rejected';

/**
 * Which statuses belong to which rail (ADR 0001 D5).
 *
 * The four chain states describe a transaction on a blockchain and the four
 * card states describe an authorization at a card acquirer; neither set is
 * expressible on the other rail. Mapping a card authorization onto `broadcast`
 * would be cheaper and would be a lie — nothing was broadcast, there is no
 * transaction, and `payment_intents_broadcast_requires_txid_check` would then
 * be demanding a txid from a payment that can never have one.
 *
 * `db/schema/payments.ts` renders these two sets into CHECK constraints, so the
 * restriction holds against a write that skipped the application.
 */
export const CHAIN_ONLY_STATUSES: readonly PaymentIntentStatus[] = [
  'awaiting_approval',
  'approved',
  'broadcast',
  'confirming',
];

export const CARD_ONLY_STATUSES: readonly PaymentIntentStatus[] = [
  'requires_action',
  'processing',
  'refunded',
  'partially_refunded',
];

/**
 * Legal forward transitions of the PaymentIntent lifecycle. Terminal states
 * (refunded/expired/failed/rejected) allow no further transition here — the one
 * documented exception, a reorg dropping `settled` back to `confirming`, is
 * modelled by the backend state machine, not this happy-path table.
 *
 * ONE table for both rails, deliberately. It answers "is this a legal lifecycle
 * edge at all"; WHICH rail may reach a given status is the separate, structural
 * question the two sets above answer, in the database. A rail-parameterised
 * table would put the same restriction in two places and let them disagree.
 *
 * Self-transitions are absent because `applyEvent` short-circuits on
 * `current === target` before consulting this table — that is the idempotent
 * re-poll of the settlement watcher, and a second partial refund, which change
 * an amount without changing a status.
 */
const ALLOWED: Record<PaymentIntentStatus, readonly PaymentIntentStatus[]> = {
  // `created` supports three paths: the rich wallet flow (→ awaiting_approval →
  // approved → broadcast), the minimal path where the payer pays out-of-band
  // and reports the txid directly (→ broadcast), and the card path (→
  // requires_action for an SCA challenge, → processing, or straight to settled
  // for a charge that confirms in one call). `failed` is reachable from here
  // because a card can be declined on first confirmation, having never been
  // anything else; no FairCoin path uses that edge, since `underpaid` is only
  // emitted for an intent that already carries a txid.
  created: [
    'awaiting_approval',
    'broadcast',
    'requires_action',
    'processing',
    'settled',
    'failed',
    'rejected',
    'expired',
  ],
  awaiting_approval: ['approved', 'rejected', 'expired'],
  approved: ['broadcast', 'failed'],
  broadcast: ['confirming', 'failed'],
  confirming: ['settled', 'failed'],
  requires_action: ['processing', 'settled', 'failed', 'expired', 'rejected'],
  processing: ['settled', 'failed'],
  // Money coming back requires money to have arrived, so both refund states are
  // reachable only from `settled` (or from each other, one way).
  settled: ['refunded', 'partially_refunded'],
  partially_refunded: ['refunded'],
  refunded: [],
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
  /** Which rail moves this payment. Decides which fields below are populated. */
  rail: PaymentIntentRail;
  /**
   * Amount in the currency's SMALLEST unit as a canonical integer string.
   * Never a float, and never interpretable without `currency`: m⊜ (10^-8 FAIR)
   * on the faircoin rail, cents on a fiat one.
   */
  amount: string;
  currency: CurrencyCode;
  /** FairCoin rail only. `null` on a card payment, which has no network. */
  network: NetworkType | null;
  /**
   * Watch-only receive address derived per-intent from the merchant xpub.
   * FairCoin rail only; `null` on a card payment, which reserves no address.
   */
  address: string | null;
  merchantId: string;
  txid: string | null;
  /** On-chain confirmations. Structurally `0` for the whole life of a card payment. */
  confirmations: number;
  clientSecret: string;
  metadata: Record<string, string>;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePaymentIntentParams {
  /** Amount in the currency's smallest unit, as a canonical integer string. */
  amount: string;
  /**
   * Defaults to `'faircoin'` — the rail this gateway shipped with, so every
   * integration written before ADR 0001 keeps working unchanged.
   */
  rail?: PaymentIntentRail;
  /** Required on the faircoin rail; refused on the card rail, which has none. */
  network?: NetworkType;
  /** Defaults to `'FAIR'` on the faircoin rail; required on the card rail. */
  currency?: CurrencyCode;
  metadata?: Record<string, string>;
  expiresInSeconds?: number;
}

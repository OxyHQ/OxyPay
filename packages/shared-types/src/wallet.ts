import type { Currency, Money } from './money';

/**
 * A user's Oxy Pay wallet. One wallet per `(userId, currency)` pair.
 * Balances are non-negative and held custodial by the Oxy Pay backend.
 */
export interface Wallet {
  id: string;
  userId: string;
  currency: Currency;
  balance: Money;
  /** Funds held against pending withdrawals or unconfirmed top-ups. */
  pending: Money;
  /** ISO date string. */
  createdAt: string;
  /** ISO date string. */
  updatedAt: string;
  /** Soft-freeze flag (compliance / fraud review). */
  frozen?: boolean;
}

/**
 * Aggregate wallet view returned from `GET /wallets`. Frontend uses this to
 * render the home screen at a glance.
 */
export interface WalletSummary {
  wallets: Wallet[];
  totalEquivalent: Money;
}

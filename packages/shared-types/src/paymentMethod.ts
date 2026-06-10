/**
 * Identifiers for the on-screen payment methods supported by Oxy Pay.
 *
 * - `oxy_balance` — pay from the user's Oxy Pay balance. Fastest path.
 * - `faircoin` — pay on-chain via FairCoin (top-up first, then debit).
 * - `card` — credit/debit card on/off ramp (regulated provider, disabled
 *    by default).
 */
export type PaymentMethodId = 'oxy_balance' | 'faircoin' | 'card';

export interface PaymentMethodDescriptor {
  id: PaymentMethodId;
  /** Translation key under `payment.methods.*` in the SDK i18n bundle. */
  i18nKey: string;
  /** Ionicons name (for the bottom-sheet entry). */
  icon: string;
  /** Whether this method is currently enabled at the backend. */
  enabled: boolean;
  /** Whether recurring (subscription) payments are supported. */
  supportsRecurring: boolean;
}

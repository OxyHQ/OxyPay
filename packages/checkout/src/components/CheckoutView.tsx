import { useEffect, useState } from 'react';
import type { MerchantDisplay, PaymentIntent } from '@peable/shared-types';
import { subscribe } from '../lib/intentClient';
import { MerchantIdentity } from './MerchantIdentity';
import { PayWithPeable } from './PayWithPeable';
import { StatusPanel } from './StatusPanel';

export interface CheckoutViewProps {
  /** The initial REST snapshot (already loaded by the route) — the first
   * frame; the realtime subscription below supplies every update after it. */
  intent: PaymentIntent;
  /** Only `/l/:linkId` and `/c/:sessionId` have merchant identity available —
   * `/i/:intentId`'s own DTO carries just `merchantId`, not a display object. */
  merchant?: MerchantDisplay;
  /** Only the checkout-session flow (`/c/:sessionId`) has a redirect target. */
  successUrl?: string;
}

const AWAITING_PAYMENT_STATUSES: ReadonlySet<PaymentIntent['status']> = new Set([
  'created',
  'awaiting_approval',
]);

export function CheckoutView({ intent: initialIntent, merchant, successUrl }: CheckoutViewProps) {
  const [intent, setIntent] = useState(initialIntent);

  // A fresh mint/reuse (LinkRoute) or a route re-navigation swaps the whole
  // intent identity — reset the locally-tracked live state to match.
  useEffect(() => {
    setIntent(initialIntent);
  }, [initialIntent]);

  // Subscribe on mount, unsubscribe on unmount (mirrors the wallet's
  // `subscriptionRef` cleanup, app/pay/[intent].tsx:188-193). No REST-poll
  // fallback: the Gateway now accepts anonymous, token-less socket
  // connections, authorizing each subscribe by the intent's `client_secret`
  // (the same capability the wallet's own room-join already relies on).
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    subscribe(initialIntent.id, initialIntent.clientSecret, (updated) => {
      if (!cancelled) setIntent(updated);
    })
      .then((unsub) => {
        if (cancelled) {
          unsub();
          return;
        }
        unsubscribe = unsub;
      })
      .catch(() => {
        // Realtime channel unavailable — the initial REST snapshot already
        // rendered; the payer just won't see live updates without a refresh.
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [initialIntent.id, initialIntent.clientSecret]);

  const awaitingPayment = AWAITING_PAYMENT_STATUSES.has(intent.status);

  return (
    <div className="checkout-view">
      {merchant && <MerchantIdentity merchant={merchant} />}
      {awaitingPayment ? (
        <PayWithPeable intent={intent} />
      ) : (
        <StatusPanel intent={intent} successUrl={successUrl} />
      )}
    </div>
  );
}

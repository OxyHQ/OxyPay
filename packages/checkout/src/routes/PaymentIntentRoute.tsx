import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { createOxyPayCheckout } from '@oxyhq/pay/checkout';
import type { PaymentIntent } from '@oxypay/shared-types';
import { formatFair } from '@fairco.in/core';
import { GATEWAY_URL } from '../lib/config';

// Placeholder for `/i/:intentId` — renders a single `PaymentIntent` (QR +
// live status). Wired against the frozen `@oxyhq/pay/checkout` client core so
// the full dependency graph (SDK workspace link, shared-types, the
// @fairco.in/core display helpers) is exercised end to end now, not just
// typechecked. The client core itself throws "not implemented" until Task 5
// lands — this route is the thin shell Task 8 replaces with the real REST
// snapshot + socket subscription + QR render.
export function PaymentIntentRoute() {
  const { intentId } = useParams<{ intentId: string }>();
  const [searchParams] = useSearchParams();
  const clientSecret = searchParams.get('client_secret');
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [pending, setPending] = useState(true);

  useEffect(() => {
    if (!intentId || !clientSecret) {
      setPending(false);
      return;
    }
    let cancelled = false;
    createOxyPayCheckout({ gatewayUrl: GATEWAY_URL })
      .getPaymentIntent(intentId, clientSecret)
      .then((result) => {
        if (cancelled) return;
        setIntent(result);
        setPending(false);
      })
      .catch(() => {
        // Expected until Task 5 lands the real client core — the frozen
        // interface throws "not implemented" for every method.
        if (!cancelled) setPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [intentId, clientSecret]);

  return (
    <main className="checkout-page">
      {pending && <p className="checkout-page__pending">Loading payment intent {intentId}…</p>}
      {!pending && intent && (
        <p className="checkout-page__pending">
          {formatFair(BigInt(intent.amount))} FAIR — {intent.status}
        </p>
      )}
      {!pending && !intent && (
        <p className="checkout-page__pending">Payment intent {intentId} is not available yet.</p>
      )}
    </main>
  );
}

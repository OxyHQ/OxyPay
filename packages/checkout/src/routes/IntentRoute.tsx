import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { PaymentIntent } from '@peable/shared-types';
import { getPaymentIntent } from '../lib/intentClient';
import type { LoadState } from '../lib/loadState';
import { CheckoutView } from '../components/CheckoutView';

// `/i/:intentId` — the simplest path: `client_secret` travels in the URL
// FRAGMENT (`#client_secret=<secret>`), not the query string, so it never
// reaches server/CDN access logs — same rationale as SessionRoute's `#cs=`.
// This route is also what the SDK embed / a deep-linked "pay" button
// targets, so the URL needs to be shareable/copyable as a whole.
export function IntentRoute() {
  const { intentId } = useParams<{ intentId: string }>();
  const [state, setState] = useState<LoadState<PaymentIntent>>({ status: 'loading' });

  useEffect(() => {
    const clientSecret = new URLSearchParams(window.location.hash.slice(1)).get('client_secret');
    if (!intentId || !clientSecret) {
      setState({ status: 'error', message: 'This payment page is missing required parameters.' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    getPaymentIntent(intentId, clientSecret)
      .then((intent) => {
        if (!cancelled) setState({ status: 'ready', data: intent });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Failed to load payment intent.';
        setState({ status: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, [intentId]);

  return (
    <main className="checkout-page">
      {state.status === 'loading' && (
        <p className="checkout-page__pending">Loading payment intent {intentId}…</p>
      )}
      {state.status === 'error' && <p className="checkout-page__pending">{state.message}</p>}
      {state.status === 'ready' && <CheckoutView intent={state.data} />}
    </main>
  );
}

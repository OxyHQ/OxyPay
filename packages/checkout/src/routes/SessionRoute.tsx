import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { CheckoutSessionPublic } from '@oxypay/shared-types';
import { gatewayGet } from '../lib/gatewayFetch';
import type { LoadState } from '../lib/loadState';
import { CheckoutView } from '../components/CheckoutView';

// `/c/:sessionId` — wraps exactly one `PaymentIntent` (Stripe Checkout
// Session parity). The client secret travels in the URL FRAGMENT
// (`#cs=<secret>`), not the query string, so it never reaches server/CDN
// access logs; the app is free to forward it as a query param on the actual
// API request, a separate request to a separate host.
export function SessionRoute() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [state, setState] = useState<LoadState<CheckoutSessionPublic>>({ status: 'loading' });

  useEffect(() => {
    const clientSecret = new URLSearchParams(window.location.hash.slice(1)).get('cs');
    if (!sessionId || !clientSecret) {
      setState({ status: 'error', message: 'This checkout link is missing required parameters.' });
      return;
    }
    let cancelled = false;
    gatewayGet<CheckoutSessionPublic>(
      `/v1/checkout_sessions/${sessionId}/public?client_secret=${encodeURIComponent(clientSecret)}`,
    )
      .then((session) => {
        if (!cancelled) setState({ status: 'ready', data: session });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'Failed to load checkout session.';
        setState({ status: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (state.status === 'loading') {
    return (
      <main className="checkout-page">
        <p className="checkout-page__pending">Loading checkout session {sessionId}…</p>
      </main>
    );
  }
  if (state.status === 'error') {
    return (
      <main className="checkout-page">
        <p className="checkout-page__pending">{state.message}</p>
      </main>
    );
  }

  const { paymentIntent, merchant, successUrl } = state.data;
  return (
    <main className="checkout-page">
      <CheckoutView intent={paymentIntent} merchant={merchant} successUrl={successUrl} />
    </main>
  );
}

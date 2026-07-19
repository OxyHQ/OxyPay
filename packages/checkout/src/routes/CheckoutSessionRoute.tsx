import { useParams } from 'react-router-dom';

// Placeholder for `/c/:sessionId` — renders a `CheckoutSession` (multi-item,
// Stripe Checkout-equivalent). The real REST snapshot fetch + socket
// subscription lands in Task 8; this shell only proves the route resolves.
export function CheckoutSessionRoute() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return (
    <main className="checkout-page">
      <p className="checkout-page__pending">Loading checkout session {sessionId}…</p>
    </main>
  );
}

import { useParams } from 'react-router-dom';

// Placeholder for `/l/:linkId` — renders a `PaymentLink` (reusable,
// merchant-shared payment page). Real data fetch lands in Task 8.
export function PaymentLinkRoute() {
  const { linkId } = useParams<{ linkId: string }>();
  return (
    <main className="checkout-page">
      <p className="checkout-page__pending">Loading payment link {linkId}…</p>
    </main>
  );
}

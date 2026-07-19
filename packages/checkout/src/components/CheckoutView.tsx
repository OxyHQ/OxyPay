import type { PaymentIntent } from '@oxypay/shared-types';
import { formatFair } from '@fairco.in/core';

// Thin placeholder — the amount hero, mode A wallet deep link, and live
// status subscription land in Task 9. Every route loader (Intent/Link/
// Session) converges on this one component once it has a resolved
// `PaymentIntent`, so Task 9 only has to build the real view once.
export function CheckoutView({ intent }: { intent: PaymentIntent }) {
  return (
    <p className="checkout-page__pending">
      {formatFair(BigInt(intent.amount))} FAIR — {intent.status}
    </p>
  );
}

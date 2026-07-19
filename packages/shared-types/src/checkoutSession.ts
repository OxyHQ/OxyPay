// CheckoutSession contract — wraps exactly ONE `PaymentIntent`, created at
// session-create time, with `success_url`/`cancel_url` for a hosted checkout
// redirect flow (Stripe Checkout Session parity).
import type { NetworkType } from './network';
import type { MerchantDisplay } from './merchantDisplay';
import type { PaymentIntent } from './paymentIntent';

/** The merchant/SDK-facing DTO — returned on create and by merchant retrieve. */
export interface CheckoutSession {
  id: string;
  object: 'checkout_session';
  paymentIntentId: string;
  /** The wrapped intent's `client_secret`, returned to the merchant on create. */
  clientSecret: string;
  amount: string;
  network: NetworkType;
  metadata: Record<string, string>;
  successUrl?: string;
  cancelUrl?: string;
  /** Canonical `checkout.oxy.so/c/<id>` URL. */
  url: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * What the checkout page loads at `/c/:id`, authorized by possession of the
 * wrapped intent's `client_secret` (never a service token). `paymentIntent`
 * reuses `toPaymentIntentDTO`'s output unchanged — it already carries
 * `clientSecret`, which the page needs to open the socket and to `submit_tx`.
 */
export interface CheckoutSessionPublic {
  id: string;
  object: 'checkout_session';
  successUrl?: string;
  cancelUrl?: string;
  merchant: MerchantDisplay;
  paymentIntent: PaymentIntent;
}

export interface CreateCheckoutSessionParams {
  amount: string;
  network: NetworkType;
  metadata?: Record<string, string>;
  successUrl?: string;
  cancelUrl?: string;
}

// PaymentLink contract — a shareable, reusable generator of `PaymentIntent`s.
// A link's price is immutable once shared (only `active`/`metadata`/`successUrl`
// are mutable); each payer visit mints (or, at the page layer, reuses an open)
// a fresh `PaymentIntent` bound to the link's merchant/amount/network.
import type { NetworkType } from './network';
import type { MerchantDisplay } from './merchantDisplay';

/** The merchant-facing DTO — returned by the merchant-authed CRUD routes. */
export interface PaymentLink {
  id: string;
  object: 'payment_link';
  /** Amount in base units (m⊜) as a canonical integer string. Never a float. */
  amount: string;
  network: NetworkType;
  active: boolean;
  metadata: Record<string, string>;
  /** Optional post-payment redirect target for the checkout page. */
  successUrl?: string;
  /** Canonical `checkout.peable.to/l/<id>` URL. */
  url: string;
  createdAt: string;
  updatedAt: string;
}

/** What an unauthenticated checkout-page visitor may see — no secrets, no metadata. */
export interface PublicPaymentLink {
  id: string;
  object: 'payment_link';
  amount: string;
  network: NetworkType;
  active: boolean;
  merchant: MerchantDisplay;
}

export interface CreatePaymentLinkParams {
  amount: string;
  network: NetworkType;
  metadata?: Record<string, string>;
  successUrl?: string;
}

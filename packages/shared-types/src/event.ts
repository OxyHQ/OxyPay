// Webhook event envelope — Stripe-parity dotted event types with the resource
// object nested under `data.object`, delivered HMAC-signed by the dispatcher.
import type { PaymentIntent } from './paymentIntent';

export type WebhookEventType =
  | 'payment_intent.confirming'
  | 'payment_intent.settled'
  | 'payment_intent.failed'
  | 'payment_intent.rejected'
  | 'payment_intent.expired';

export interface WebhookEvent<T = PaymentIntent> {
  id: string;
  object: 'event';
  type: WebhookEventType;
  created: string;
  data: { object: T };
}

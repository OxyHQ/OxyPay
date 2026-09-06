import type { CheckoutSession, CreateCheckoutSessionParams } from '@peable.to/shared-types';
import type { RestClient } from '../core/client';

export class CheckoutSessionsResource {
  constructor(private readonly client: RestClient) {}

  create(params: CreateCheckoutSessionParams): Promise<CheckoutSession> {
    return this.client.request<CheckoutSession>('POST', '/v1/checkout_sessions', {
      body: params,
    });
  }

  retrieve(id: string): Promise<CheckoutSession> {
    return this.client.request<CheckoutSession>(
      'GET',
      `/v1/checkout_sessions/${encodeURIComponent(id)}`,
    );
  }
}

/** `peable.checkout.sessions.*` — a thin namespace wrapper so the public API
 * reads `peable.checkout.sessions.create(...)` (Stripe Checkout Session
 * parity), leaving room for future `peable.checkout.*` resources. */
export class CheckoutResource {
  readonly sessions: CheckoutSessionsResource;

  constructor(client: RestClient) {
    this.sessions = new CheckoutSessionsResource(client);
  }
}

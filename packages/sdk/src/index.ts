// Server entry (`@peable.to/sdk`) — the merchant-authed SDK. Configured with a
// confidential `ApplicationCredential` (`{publicKey, secret}`); mints and
// caches an Oxy service token, and exposes Stripe-ergonomics resource
// namespaces over the Gateway REST contract.
//
// Deliberately never imports `socket.io-client` or `./browser/*` — the
// server bundle stays lean and holds no browser-only code.
import { resolveConfig, type PeableConfig } from './core/config';
import { createServiceTokenProvider } from './core/serviceToken';
import { createRestClient } from './core/client';
import { PaymentIntentsResource } from './resources/paymentIntents';
import { PaymentLinksResource } from './resources/paymentLinks';
import { CheckoutResource } from './resources/checkoutSessions';
import { WebhooksResource } from './resources/webhooks';

export class Peable {
  readonly paymentIntents: PaymentIntentsResource;
  readonly paymentLinks: PaymentLinksResource;
  readonly checkout: CheckoutResource;
  readonly webhooks: WebhooksResource;

  constructor(config: PeableConfig) {
    const resolved = resolveConfig(config);
    const tokenProvider = createServiceTokenProvider(config);
    const client = createRestClient({ baseURL: resolved.baseURL }, tokenProvider);

    this.paymentIntents = new PaymentIntentsResource(client);
    this.paymentLinks = new PaymentLinksResource(client);
    this.checkout = new CheckoutResource(client);
    this.webhooks = new WebhooksResource();
  }
}

export type { PeableConfig, ResolvedPeableConfig } from './core/config';
export { DEFAULT_GATEWAY_BASE_URL, DEFAULT_OXY_API_URL } from './core/config';

export {
  PeableError,
  PeableAuthenticationError,
  PeableInvalidRequestError,
  PeablePermissionError,
  PeableApiError,
  PeableSignatureVerificationError,
} from './core/errors';
export type { PeableErrorType, PeableErrorDetails } from './core/errors';

export type { RestClient, RestClientRequestOptions } from './core/client';
export type { ServiceTokenProvider } from './core/serviceToken';

export type {
  CreatePaymentIntentOptions,
  PaymentIntentListParams,
  PaymentIntentList,
} from './resources/paymentIntents';
export type {
  PaymentLinkListParams,
  PaymentLinkList,
  UpdatePaymentLinkParams,
} from './resources/paymentLinks';
export { WEBHOOK_SIGNATURE_HEADER } from './resources/webhooks';
export type { ConstructEventOptions } from './resources/webhooks';

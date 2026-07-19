import type {
  CreatePaymentIntentParams,
  PaymentIntent,
  PaymentIntentStatus,
} from '@oxypay/shared-types';
import type { RestClient } from '../core/client';

export interface PaymentIntentListParams {
  status?: PaymentIntentStatus;
  limit?: number;
  starting_after?: string;
}

export interface PaymentIntentList {
  object: 'list';
  data: PaymentIntent[];
  has_more: boolean;
}

export interface CreatePaymentIntentOptions {
  /**
   * Required — the Gateway mandates the `Idempotency-Key` header on
   * `POST /v1/payment_intents` (`paymentIntents.ts`'s `idempotencyKey`
   * check). Making this a required option (not optional) means a caller
   * cannot forget it.
   */
  idempotencyKey: string;
}

export class PaymentIntentsResource {
  constructor(private readonly client: RestClient) {}

  create(
    params: CreatePaymentIntentParams,
    options: CreatePaymentIntentOptions,
  ): Promise<PaymentIntent> {
    return this.client.request<PaymentIntent>('POST', '/v1/payment_intents', {
      body: params,
      idempotencyKey: options.idempotencyKey,
    });
  }

  retrieve(id: string): Promise<PaymentIntent> {
    return this.client.request<PaymentIntent>(
      'GET',
      `/v1/payment_intents/${encodeURIComponent(id)}`,
    );
  }

  list(params: PaymentIntentListParams = {}): Promise<PaymentIntentList> {
    return this.client.request<PaymentIntentList>('GET', '/v1/payment_intents', {
      query: {
        status: params.status,
        limit: params.limit,
        starting_after: params.starting_after,
      },
    });
  }

  reject(id: string): Promise<PaymentIntent> {
    return this.client.request<PaymentIntent>(
      'POST',
      `/v1/payment_intents/${encodeURIComponent(id)}/reject`,
    );
  }
}

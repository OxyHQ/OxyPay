import { describe, expect, test } from 'bun:test';
import { CheckoutResource } from '../../src/resources/checkoutSessions';
import { createMockFetch, type CapturedRequest } from '../support/mockFetch';
import { buildTestClient, serviceTokenMintResponse, TEST_GATEWAY_URL } from '../support/testGateway';

function gatewayCallOf(requests: CapturedRequest[]): CapturedRequest | undefined {
  return requests.find((r) => !r.url.includes('/auth/service-token'));
}

describe('CheckoutResource.sessions', () => {
  test('create() POSTs /v1/checkout_sessions and returns the CheckoutSession DTO', async () => {
    const { fetch: fetchImpl, requests } = createMockFetch((req) => {
      if (req.url.includes('/auth/service-token')) return serviceTokenMintResponse();
      return {
        status: 201,
        json: {
          id: 'cs_1',
          object: 'checkout_session',
          paymentIntentId: 'pi_1',
          clientSecret: 'pi_1_secret_x',
          amount: '100000',
          network: 'testnet',
          metadata: {},
          url: 'https://checkout.peable.to/c/cs_1',
        },
      };
    });
    const checkout = new CheckoutResource(buildTestClient(fetchImpl));

    const session = await checkout.sessions.create({ amount: '100000', network: 'testnet' });

    expect(session.id).toBe('cs_1');
    expect(session.clientSecret).toBe('pi_1_secret_x');
    const call = gatewayCallOf(requests);
    expect(call?.method).toBe('POST');
    expect(call?.url).toBe(`${TEST_GATEWAY_URL}/v1/checkout_sessions`);
    expect(call?.headers.get('Idempotency-Key')).toBeNull();
    expect(JSON.parse(call?.body ?? '{}')).toEqual({ amount: '100000', network: 'testnet' });
  });

  test('retrieve() GETs /v1/checkout_sessions/:id', async () => {
    const { fetch: fetchImpl, requests } = createMockFetch((req) => {
      if (req.url.includes('/auth/service-token')) return serviceTokenMintResponse();
      return { status: 200, json: { id: 'cs_1', object: 'checkout_session' } };
    });
    const checkout = new CheckoutResource(buildTestClient(fetchImpl));

    await checkout.sessions.retrieve('cs_1');

    expect(gatewayCallOf(requests)?.url).toBe(`${TEST_GATEWAY_URL}/v1/checkout_sessions/cs_1`);
  });
});

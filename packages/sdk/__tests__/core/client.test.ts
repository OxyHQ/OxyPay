import { describe, expect, test } from 'bun:test';
import { createRestClient } from '../../src/core/client';
import { OxyPayApiError, OxyPayAuthenticationError, OxyPayInvalidRequestError } from '../../src/core/errors';
import type { ServiceTokenProvider } from '../../src/core/serviceToken';
import { createMockFetch } from '../support/mockFetch';
import { TEST_GATEWAY_URL } from '../support/testGateway';

/** A `ServiceTokenProvider` test double: returns `tokens[n]` where `n` is the
 * number of times `invalidate()` has been called, so a 401-retry test can
 * assert the client picked up a freshly-minted token on its second try. */
function fakeTokenProvider(tokens: string[]): {
  provider: ServiceTokenProvider;
  invalidateCalls: number[];
} {
  const invalidateCalls: number[] = [];
  let index = 0;
  return {
    provider: {
      getToken: async () => tokens[Math.min(index, tokens.length - 1)] as string,
      invalidate: () => {
        index += 1;
        invalidateCalls.push(index);
      },
    },
    invalidateCalls,
  };
}

describe('createRestClient', () => {
  test('attaches the bearer token and omits Content-Type/Idempotency-Key when absent', async () => {
    const { fetch: fetchImpl, requests } = createMockFetch(() => ({
      status: 200,
      json: { object: 'payment_intent' },
    }));
    const { provider } = fakeTokenProvider(['tok_1']);
    const client = createRestClient({ baseURL: TEST_GATEWAY_URL }, provider, { fetch: fetchImpl });

    await client.request('GET', '/v1/payment_intents/pi_1');

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.url).toBe(`${TEST_GATEWAY_URL}/v1/payment_intents/pi_1`);
    expect(requests[0]?.headers.get('Authorization')).toBe('Bearer tok_1');
    expect(requests[0]?.headers.get('Content-Type')).toBeNull();
    expect(requests[0]?.headers.get('Idempotency-Key')).toBeNull();
  });

  test('serializes a JSON body and sets Content-Type', async () => {
    const { fetch: fetchImpl, requests } = createMockFetch(() => ({ status: 201, json: { id: 'pi_1' } }));
    const { provider } = fakeTokenProvider(['tok_1']);
    const client = createRestClient({ baseURL: TEST_GATEWAY_URL }, provider, { fetch: fetchImpl });

    await client.request('POST', '/v1/payment_intents', { body: { amount: '100' } });

    expect(requests[0]?.headers.get('Content-Type')).toBe('application/json');
    expect(JSON.parse(requests[0]?.body ?? '{}')).toEqual({ amount: '100' });
  });

  test('sets the Idempotency-Key header when given', async () => {
    const { fetch: fetchImpl, requests } = createMockFetch(() => ({ status: 201, json: {} }));
    const { provider } = fakeTokenProvider(['tok_1']);
    const client = createRestClient({ baseURL: TEST_GATEWAY_URL }, provider, { fetch: fetchImpl });

    await client.request('POST', '/v1/payment_intents', {
      body: { amount: '100' },
      idempotencyKey: 'idem-123',
    });

    expect(requests[0]?.headers.get('Idempotency-Key')).toBe('idem-123');
  });

  test('serializes query params and skips undefined values', async () => {
    const { fetch: fetchImpl, requests } = createMockFetch(() => ({
      status: 200,
      json: { object: 'list', data: [], has_more: false },
    }));
    const { provider } = fakeTokenProvider(['tok_1']);
    const client = createRestClient({ baseURL: TEST_GATEWAY_URL }, provider, { fetch: fetchImpl });

    await client.request('GET', '/v1/payment_intents', {
      query: { status: 'settled', limit: 10, starting_after: undefined },
    });

    const url = new URL(requests[0]?.url ?? '');
    expect(url.searchParams.get('status')).toBe('settled');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(url.searchParams.has('starting_after')).toBe(false);
  });

  test('returns the parsed JSON body on 2xx', async () => {
    const { fetch: fetchImpl } = createMockFetch(() => ({
      status: 200,
      json: { id: 'pi_1', status: 'created' },
    }));
    const { provider } = fakeTokenProvider(['tok_1']);
    const client = createRestClient({ baseURL: TEST_GATEWAY_URL }, provider, { fetch: fetchImpl });

    const result = await client.request<{ id: string; status: string }>(
      'GET',
      '/v1/payment_intents/pi_1',
    );

    expect(result).toEqual({ id: 'pi_1', status: 'created' });
  });

  test('maps a non-2xx nested-envelope response to a typed OxyPayError', async () => {
    const { fetch: fetchImpl } = createMockFetch(() => ({
      status: 422,
      json: { error: { type: 'invalid_request_error', message: 'bad amount' } },
    }));
    const { provider } = fakeTokenProvider(['tok_1']);
    const client = createRestClient({ baseURL: TEST_GATEWAY_URL }, provider, { fetch: fetchImpl });

    await expect(client.request('POST', '/v1/payment_intents', { body: {} })).rejects.toBeInstanceOf(
      OxyPayInvalidRequestError,
    );
  });

  test('on 401, invalidates the token and retries once with a fresh token', async () => {
    let callCount = 0;
    const { fetch: fetchImpl, requests } = createMockFetch((req) => {
      callCount += 1;
      if (callCount === 1) {
        return { status: 401, json: { error: 'TOKEN_EXPIRED', message: 'Service token expired' } };
      }
      // Second attempt must carry the freshly-minted token.
      expect(req.headers.get('Authorization')).toBe('Bearer tok_2');
      return { status: 200, json: { id: 'pi_1' } };
    });
    const { provider, invalidateCalls } = fakeTokenProvider(['tok_1', 'tok_2']);
    const client = createRestClient({ baseURL: TEST_GATEWAY_URL }, provider, { fetch: fetchImpl });

    const result = await client.request<{ id: string }>('GET', '/v1/payment_intents/pi_1');

    expect(result).toEqual({ id: 'pi_1' });
    expect(requests).toHaveLength(2);
    expect(invalidateCalls).toHaveLength(1);
  });

  test('a second consecutive 401 is NOT retried again — throws the mapped auth error', async () => {
    const { fetch: fetchImpl, requests } = createMockFetch(() => ({
      status: 401,
      json: { error: 'TOKEN_EXPIRED', message: 'Service token expired' },
    }));
    const { provider, invalidateCalls } = fakeTokenProvider(['tok_1', 'tok_2', 'tok_3']);
    const client = createRestClient({ baseURL: TEST_GATEWAY_URL }, provider, { fetch: fetchImpl });

    await expect(client.request('GET', '/v1/payment_intents/pi_1')).rejects.toBeInstanceOf(
      OxyPayAuthenticationError,
    );
    // Exactly one retry: two fetch attempts, one invalidate.
    expect(requests).toHaveLength(2);
    expect(invalidateCalls).toHaveLength(1);
  });

  test('wraps a network-level fetch failure as OxyPayApiError', async () => {
    const failingFetch = (() =>
      Promise.reject(new Error('ECONNRESET'))) as unknown as typeof fetch;
    const { provider } = fakeTokenProvider(['tok_1']);
    const client = createRestClient({ baseURL: TEST_GATEWAY_URL }, provider, { fetch: failingFetch });

    await expect(client.request('GET', '/v1/payment_intents/pi_1')).rejects.toBeInstanceOf(
      OxyPayApiError,
    );
  });
});

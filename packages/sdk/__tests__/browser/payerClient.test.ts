/**
 * `createOxyPayCheckout` — the anonymous payer-side client core (Fase 2 SDK
 * plan, Task 5). REST calls (`getPaymentIntent`/`submitTx`) are exercised
 * against a stubbed `globalThis.fetch` (the SDK's shared `createMockFetch`
 * harness); `subscribe` is exercised against a mock `socket.io-client`
 * installed via `mock.module` BEFORE importing the module under test, since
 * `payerClient.ts` imports `io` at module scope.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { PaymentIntent } from '@oxypay/shared-types';
import { createMockFetch } from '../support/mockFetch';
import { TEST_GATEWAY_URL } from '../support/testGateway';

interface FakeSocket {
  emitWithAck: ReturnType<typeof mock>;
  on: ReturnType<typeof mock>;
  off: ReturnType<typeof mock>;
  disconnect: ReturnType<typeof mock>;
}

let nextSocket: FakeSocket | null = null;
const ioCalls: Array<{ url: string; opts: unknown }> = [];

function installFakeSocket(ack: { ok: boolean } | Error): FakeSocket {
  const socket: FakeSocket = {
    emitWithAck: mock(async () => {
      if (ack instanceof Error) throw ack;
      return ack;
    }),
    on: mock(() => {}),
    off: mock(() => {}),
    disconnect: mock(() => {}),
  };
  nextSocket = socket;
  return socket;
}

// Mock socket.io-client BEFORE importing the module under test (bun:test
// convention — see `gateway-client.test.ts`/`identity-wallet.test.ts`).
mock.module('socket.io-client', () => ({
  io: (url: string, opts: unknown) => {
    ioCalls.push({ url, opts });
    if (!nextSocket) throw new Error('installFakeSocket() was not called for this test');
    return nextSocket;
  },
}));

const { createOxyPayCheckout } = await import('../../src/browser/payerClient');
const { OxyPayApiError, OxyPayInvalidRequestError, OxyPayPermissionError } = await import(
  '../../src/core/errors'
);

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  nextSocket = null;
  ioCalls.length = 0;
});

const INTENT: PaymentIntent = {
  id: 'pi_1',
  object: 'payment_intent',
  status: 'created',
  amount: '100',
  currency: 'FAIR',
  network: 'testnet',
  address: 'TAddr1',
  merchantId: 'merch_1',
  txid: null,
  confirmations: 0,
  clientSecret: 'secret_1',
  metadata: {},
  expiresAt: '2026-07-20T00:00:00.000Z',
  createdAt: '2026-07-19T00:00:00.000Z',
  updatedAt: '2026-07-19T00:00:00.000Z',
};

describe('getPaymentIntent', () => {
  test('GETs /v1/payment_intents/:id with client_secret as a query param and returns the DTO', async () => {
    const { fetch: fetchImpl, requests } = createMockFetch(() => ({
      status: 200,
      json: INTENT,
    }));
    globalThis.fetch = fetchImpl;
    const client = createOxyPayCheckout({ gatewayUrl: TEST_GATEWAY_URL });

    const result = await client.getPaymentIntent('pi_1', 'secret_1');

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.url).toBe(
      `${TEST_GATEWAY_URL}/v1/payment_intents/pi_1?client_secret=secret_1`,
    );
    expect(result).toEqual(INTENT);
  });

  test('URL-encodes the id and client_secret', async () => {
    const { fetch: fetchImpl, requests } = createMockFetch(() => ({ status: 200, json: INTENT }));
    globalThis.fetch = fetchImpl;
    const client = createOxyPayCheckout({ gatewayUrl: TEST_GATEWAY_URL });

    await client.getPaymentIntent('pi/1', 'sec ret');

    const url = new URL(requests[0]?.url ?? '');
    expect(url.pathname).toBe('/v1/payment_intents/pi%2F1');
    expect(url.searchParams.get('client_secret')).toBe('sec ret');
  });

  test('defaults gatewayUrl to https://api.pay.oxy.so when not given', async () => {
    const { fetch: fetchImpl, requests } = createMockFetch(() => ({ status: 200, json: INTENT }));
    globalThis.fetch = fetchImpl;
    const client = createOxyPayCheckout();

    await client.getPaymentIntent('pi_1', 'secret_1');

    expect(requests[0]?.url).toStartWith('https://api.pay.oxy.so/v1/payment_intents/pi_1');
  });

  test('maps a 403 invalid client_secret response to OxyPayPermissionError', async () => {
    const { fetch: fetchImpl } = createMockFetch(() => ({
      status: 403,
      json: { error: { type: 'permission_error', message: 'invalid client_secret' } },
    }));
    globalThis.fetch = fetchImpl;
    const client = createOxyPayCheckout({ gatewayUrl: TEST_GATEWAY_URL });

    await expect(client.getPaymentIntent('pi_1', 'wrong')).rejects.toBeInstanceOf(
      OxyPayPermissionError,
    );
  });

  test('maps a 404 not-found response to OxyPayInvalidRequestError', async () => {
    const { fetch: fetchImpl } = createMockFetch(() => ({
      status: 404,
      json: { error: { type: 'invalid_request_error', message: 'payment intent not found' } },
    }));
    globalThis.fetch = fetchImpl;
    const client = createOxyPayCheckout({ gatewayUrl: TEST_GATEWAY_URL });

    await expect(client.getPaymentIntent('pi_missing', 'secret_1')).rejects.toBeInstanceOf(
      OxyPayInvalidRequestError,
    );
  });

  test('wraps a network-level fetch failure as OxyPayApiError', async () => {
    globalThis.fetch = (() =>
      Promise.reject(new Error('ECONNRESET'))) as unknown as typeof fetch;
    const client = createOxyPayCheckout({ gatewayUrl: TEST_GATEWAY_URL });

    await expect(client.getPaymentIntent('pi_1', 'secret_1')).rejects.toBeInstanceOf(
      OxyPayApiError,
    );
  });
});

describe('submitTx', () => {
  test('POSTs /v1/payment_intents/:id/submit_tx with {client_secret, txid} and returns the DTO', async () => {
    const broadcast: PaymentIntent = { ...INTENT, status: 'broadcast', txid: 'tx_abc' };
    const { fetch: fetchImpl, requests } = createMockFetch(() => ({
      status: 200,
      json: broadcast,
    }));
    globalThis.fetch = fetchImpl;
    const client = createOxyPayCheckout({ gatewayUrl: TEST_GATEWAY_URL });

    const result = await client.submitTx('pi_1', 'secret_1', 'tx_abc');

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.url).toBe(`${TEST_GATEWAY_URL}/v1/payment_intents/pi_1/submit_tx`);
    expect(requests[0]?.headers.get('Content-Type')).toBe('application/json');
    expect(JSON.parse(requests[0]?.body ?? '{}')).toEqual({
      client_secret: 'secret_1',
      txid: 'tx_abc',
    });
    expect(result).toEqual(broadcast);
  });

  test('maps a 409 illegal state transition response to OxyPayInvalidRequestError', async () => {
    const { fetch: fetchImpl } = createMockFetch(() => ({
      status: 409,
      json: { error: { type: 'invalid_request_error', message: 'illegal state transition' } },
    }));
    globalThis.fetch = fetchImpl;
    const client = createOxyPayCheckout({ gatewayUrl: TEST_GATEWAY_URL });

    await expect(client.submitTx('pi_1', 'secret_1', 'tx_abc')).rejects.toBeInstanceOf(
      OxyPayInvalidRequestError,
    );
  });

  test('wraps a network-level fetch failure as OxyPayApiError', async () => {
    globalThis.fetch = (() =>
      Promise.reject(new Error('ECONNRESET'))) as unknown as typeof fetch;
    const client = createOxyPayCheckout({ gatewayUrl: TEST_GATEWAY_URL });

    await expect(client.submitTx('pi_1', 'secret_1', 'tx_abc')).rejects.toBeInstanceOf(
      OxyPayApiError,
    );
  });
});

describe('subscribe', () => {
  test('connects anonymously (no auth option) and emits subscribe with {intentId, clientSecret}', async () => {
    const socket = installFakeSocket({ ok: true });
    const client = createOxyPayCheckout({ gatewayUrl: TEST_GATEWAY_URL });

    await client.subscribe('pi_1', 'secret_1', () => {});

    expect(ioCalls).toHaveLength(1);
    expect(ioCalls[0]?.url).toBe(TEST_GATEWAY_URL);
    expect(ioCalls[0]?.opts).toEqual({ transports: ['websocket'] });
    expect(socket.emitWithAck).toHaveBeenCalledWith('subscribe', {
      intentId: 'pi_1',
      clientSecret: 'secret_1',
    });
  });

  test('calls onUpdate only for intent.updated events matching this intent id', async () => {
    const socket = installFakeSocket({ ok: true });
    const client = createOxyPayCheckout({ gatewayUrl: TEST_GATEWAY_URL });
    const updates: PaymentIntent[] = [];

    await client.subscribe('pi_1', 'secret_1', (intent) => updates.push(intent));

    const listener = socket.on.mock.calls[0]?.[1] as (intent: PaymentIntent) => void;
    expect(socket.on.mock.calls[0]?.[0]).toBe('intent.updated');

    listener({ ...INTENT, id: 'pi_OTHER', status: 'broadcast' });
    listener({ ...INTENT, id: 'pi_1', status: 'broadcast' });

    expect(updates).toHaveLength(1);
    expect(updates[0]?.id).toBe('pi_1');
    expect(updates[0]?.status).toBe('broadcast');
  });

  test('unsubscribe removes the listener and disconnects the socket', async () => {
    const socket = installFakeSocket({ ok: true });
    const client = createOxyPayCheckout({ gatewayUrl: TEST_GATEWAY_URL });

    const { unsubscribe } = await client.subscribe('pi_1', 'secret_1', () => {});
    const listener = socket.on.mock.calls[0]?.[1];

    unsubscribe();

    expect(socket.off).toHaveBeenCalledWith('intent.updated', listener);
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });

  test('a rejected ack (ok: false) disconnects the socket and throws OxyPayInvalidRequestError', async () => {
    const socket = installFakeSocket({ ok: false });
    const client = createOxyPayCheckout({ gatewayUrl: TEST_GATEWAY_URL });

    await expect(client.subscribe('pi_1', 'wrong-secret', () => {})).rejects.toBeInstanceOf(
      OxyPayInvalidRequestError,
    );
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    expect(socket.on).not.toHaveBeenCalled();
  });

  test('an emitWithAck failure disconnects the socket and throws OxyPayApiError', async () => {
    const socket = installFakeSocket(new Error('socket disconnected before ack'));
    const client = createOxyPayCheckout({ gatewayUrl: TEST_GATEWAY_URL });

    await expect(client.subscribe('pi_1', 'secret_1', () => {})).rejects.toBeInstanceOf(
      OxyPayApiError,
    );
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });
});

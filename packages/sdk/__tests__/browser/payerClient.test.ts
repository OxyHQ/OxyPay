import { describe, expect, test } from 'bun:test';
import { createOxyPayCheckout } from '../../src/browser/payerClient';

describe('createOxyPayCheckout (frozen interface, Task 5 stub)', () => {
  test('returns a client exposing getPaymentIntent/subscribe/submitTx', () => {
    const client = createOxyPayCheckout();

    expect(typeof client.getPaymentIntent).toBe('function');
    expect(typeof client.subscribe).toBe('function');
    expect(typeof client.submitTx).toBe('function');
  });

  test('every method throws a clear "not implemented yet" error until Task 5 lands', async () => {
    const client = createOxyPayCheckout({ gatewayUrl: 'https://api.pay.oxy.test' });

    await expect(client.getPaymentIntent('pi_1', 'secret')).rejects.toThrow(/not implemented/i);
    await expect(client.subscribe('pi_1', 'secret', () => {})).rejects.toThrow(/not implemented/i);
    await expect(client.submitTx('pi_1', 'secret', 'txid')).rejects.toThrow(/not implemented/i);
  });
});

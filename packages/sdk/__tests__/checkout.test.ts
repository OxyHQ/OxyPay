import { describe, expect, test } from 'bun:test';
import { createOxyPayCheckout } from '../src/checkout';

describe('"./checkout" entry', () => {
  test('re-exports createOxyPayCheckout from browser/payerClient', () => {
    const client = createOxyPayCheckout({ gatewayUrl: 'https://api.pay.oxy.test' });
    expect(typeof client.getPaymentIntent).toBe('function');
    expect(typeof client.subscribe).toBe('function');
    expect(typeof client.submitTx).toBe('function');
  });
});

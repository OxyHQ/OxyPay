import { describe, expect, test } from 'bun:test';
import { createPeableCheckout } from '../src/checkout';

describe('"./checkout" entry', () => {
  test('re-exports createPeableCheckout from browser/payerClient', () => {
    const client = createPeableCheckout({ gatewayUrl: 'https://api.pay.oxy.test' });
    expect(typeof client.getPaymentIntent).toBe('function');
    expect(typeof client.subscribe).toBe('function');
    expect(typeof client.submitTx).toBe('function');
  });
});

import { describe, expect, test } from 'bun:test';
import { OxyPay } from '../src/index';
import { PaymentIntentsResource } from '../src/resources/paymentIntents';
import { PaymentLinksResource } from '../src/resources/paymentLinks';
import { CheckoutResource, CheckoutSessionsResource } from '../src/resources/checkoutSessions';
import { WebhooksResource } from '../src/resources/webhooks';

describe('OxyPay', () => {
  test('wires paymentIntents/paymentLinks/checkout.sessions/webhooks', () => {
    const oxypay = new OxyPay({ publicKey: 'oxy_dk_test', secret: 'sk_test' });

    expect(oxypay.paymentIntents).toBeInstanceOf(PaymentIntentsResource);
    expect(oxypay.paymentLinks).toBeInstanceOf(PaymentLinksResource);
    expect(oxypay.checkout).toBeInstanceOf(CheckoutResource);
    expect(oxypay.checkout.sessions).toBeInstanceOf(CheckoutSessionsResource);
    expect(oxypay.webhooks).toBeInstanceOf(WebhooksResource);
  });

  test('throws when publicKey is missing (delegates to resolveConfig)', () => {
    expect(() => new OxyPay({ publicKey: '', secret: 'sk_test' })).toThrow(/publicKey/);
  });

  test('throws when secret is missing', () => {
    expect(() => new OxyPay({ publicKey: 'oxy_dk_test', secret: '' })).toThrow(/secret/);
  });
});

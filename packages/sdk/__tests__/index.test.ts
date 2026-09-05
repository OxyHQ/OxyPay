import { describe, expect, test } from 'bun:test';
import { Peable } from '../src/index';
import { PaymentIntentsResource } from '../src/resources/paymentIntents';
import { PaymentLinksResource } from '../src/resources/paymentLinks';
import { CheckoutResource, CheckoutSessionsResource } from '../src/resources/checkoutSessions';
import { WebhooksResource } from '../src/resources/webhooks';

describe('Peable', () => {
  test('wires paymentIntents/paymentLinks/checkout.sessions/webhooks', () => {
    const peable = new Peable({ publicKey: 'oxy_dk_test', secret: 'sk_test' });

    expect(peable.paymentIntents).toBeInstanceOf(PaymentIntentsResource);
    expect(peable.paymentLinks).toBeInstanceOf(PaymentLinksResource);
    expect(peable.checkout).toBeInstanceOf(CheckoutResource);
    expect(peable.checkout.sessions).toBeInstanceOf(CheckoutSessionsResource);
    expect(peable.webhooks).toBeInstanceOf(WebhooksResource);
  });

  test('throws when publicKey is missing (delegates to resolveConfig)', () => {
    expect(() => new Peable({ publicKey: '', secret: 'sk_test' })).toThrow(/publicKey/);
  });

  test('throws when secret is missing', () => {
    expect(() => new Peable({ publicKey: 'oxy_dk_test', secret: '' })).toThrow(/secret/);
  });
});

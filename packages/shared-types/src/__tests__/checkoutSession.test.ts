import { test, expect } from 'bun:test';
import type {
  CheckoutSession,
  CheckoutSessionPublic,
  CreateCheckoutSessionParams,
} from '../checkoutSession';
import type { PaymentIntent } from '../paymentIntent';

const INTENT: PaymentIntent = {
  id: 'pi_abc',
  object: 'payment_intent',
  status: 'created',
  amount: '150000000',
  currency: 'FAIR',
  network: 'testnet',
  address: 'TC8KNvRhFUJUepcCSjBBeLa5HYo4Na11w3',
  merchantId: 'merch_1',
  txid: null,
  confirmations: 0,
  clientSecret: 'pi_abc_secret_xyz',
  metadata: {},
  expiresAt: '2026-07-19T00:15:00.000Z',
  createdAt: '2026-07-19T00:00:00.000Z',
  updatedAt: '2026-07-19T00:00:00.000Z',
};

test('CheckoutSession is assignable from a representative literal', () => {
  const session: CheckoutSession = {
    id: 'cs_abc',
    object: 'checkout_session',
    paymentIntentId: INTENT.id,
    clientSecret: INTENT.clientSecret,
    amount: INTENT.amount,
    network: INTENT.network,
    metadata: {},
    successUrl: 'https://merchant.example/success',
    cancelUrl: 'https://merchant.example/cancel',
    url: 'https://checkout.oxy.so/c/cs_abc',
    createdAt: '2026-07-19T00:00:00.000Z',
    updatedAt: '2026-07-19T00:00:00.000Z',
  };
  expect(session.object).toBe('checkout_session');
});

test('CheckoutSessionPublic wraps the full PaymentIntent DTO the page renders from', () => {
  const publicSession: CheckoutSessionPublic = {
    id: 'cs_abc',
    object: 'checkout_session',
    merchant: { name: 'Acme', avatarUrl: null, description: null },
    paymentIntent: INTENT,
  };
  expect(publicSession.paymentIntent.clientSecret).toBe(INTENT.clientSecret);
});

test('CreateCheckoutSessionParams accepts the minimal required shape', () => {
  const params: CreateCheckoutSessionParams = { amount: '150000000', network: 'testnet' };
  expect(params.successUrl).toBeUndefined();
});

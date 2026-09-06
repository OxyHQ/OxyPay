import { describe, expect, test } from 'bun:test';
import { signWebhook, type WebhookEvent } from '@peable.to/shared-types';
import { WebhooksResource } from '../../src/resources/webhooks';
import { PeableSignatureVerificationError } from '../../src/core/errors';

const SECRET = 'whsec_test_secret';
const TIMESTAMP = 1700000000;

const EVENT: WebhookEvent = {
  id: 'evt_1',
  object: 'event',
  type: 'payment_intent.settled',
  created: new Date(TIMESTAMP * 1000).toISOString(),
  data: {
    object: {
      id: 'pi_1',
      object: 'payment_intent',
      status: 'settled',
  rail: 'faircoin',
      amount: '100000',
      currency: 'FAIR',
      network: 'testnet',
      address: 'addr1',
      merchantId: 'merch_1',
      txid: 'tx1',
      confirmations: 6,
      clientSecret: 'pi_1_secret_x',
      metadata: {},
      expiresAt: new Date(TIMESTAMP * 1000).toISOString(),
      createdAt: new Date(TIMESTAMP * 1000).toISOString(),
      updatedAt: new Date(TIMESTAMP * 1000).toISOString(),
    },
  },
};

const RAW_BODY = JSON.stringify(EVENT);

describe('WebhooksResource.constructEvent', () => {
  test('verifies a payload signed by shared-types signWebhook and returns the typed event', () => {
    const header = signWebhook(SECRET, RAW_BODY, TIMESTAMP);
    const resource = new WebhooksResource();

    // Freeze "now" close to the signed timestamp so it is within tolerance.
    const event = resource.constructEvent(RAW_BODY, header, SECRET, {
      // Explicit generous tolerance since the real clock has moved on since
      // the fixed TIMESTAMP above.
      toleranceSec: Number.MAX_SAFE_INTEGER,
    });

    expect(event).toEqual(EVENT);
  });

  test('rejects a tampered body', () => {
    const header = signWebhook(SECRET, RAW_BODY, TIMESTAMP);
    const tampered = JSON.stringify({ ...EVENT, id: 'evt_evil' });
    const resource = new WebhooksResource();

    expect(() =>
      resource.constructEvent(tampered, header, SECRET, { toleranceSec: Number.MAX_SAFE_INTEGER }),
    ).toThrow(PeableSignatureVerificationError);
  });

  test('rejects a signature produced with the wrong secret', () => {
    const header = signWebhook('whsec_wrong', RAW_BODY, TIMESTAMP);
    const resource = new WebhooksResource();

    expect(() =>
      resource.constructEvent(RAW_BODY, header, SECRET, { toleranceSec: Number.MAX_SAFE_INTEGER }),
    ).toThrow(PeableSignatureVerificationError);
  });

  test('rejects a stale timestamp beyond the default tolerance', () => {
    const staleTimestamp = Math.floor(Date.now() / 1000) - 10_000;
    const header = signWebhook(SECRET, RAW_BODY, staleTimestamp);
    const resource = new WebhooksResource();

    expect(() => resource.constructEvent(RAW_BODY, header, SECRET)).toThrow(
      PeableSignatureVerificationError,
    );
  });

  test('respects a custom toleranceSec', () => {
    const timestamp = Math.floor(Date.now() / 1000) - 120;
    const header = signWebhook(SECRET, RAW_BODY, timestamp);
    const resource = new WebhooksResource();

    expect(() => resource.constructEvent(RAW_BODY, header, SECRET, { toleranceSec: 60 })).toThrow(
      PeableSignatureVerificationError,
    );
    expect(() =>
      resource.constructEvent(RAW_BODY, header, SECRET, { toleranceSec: 300 }),
    ).not.toThrow();
  });

  test('rejects a signature-valid but non-JSON body', () => {
    const rawBody = 'not json';
    const header = signWebhook(SECRET, rawBody, TIMESTAMP);
    const resource = new WebhooksResource();

    expect(() =>
      resource.constructEvent(rawBody, header, SECRET, { toleranceSec: Number.MAX_SAFE_INTEGER }),
    ).toThrow(PeableSignatureVerificationError);
  });

  test('rejects a signature-valid JSON body that does not match the event shape', () => {
    const rawBody = JSON.stringify({ hello: 'world' });
    const header = signWebhook(SECRET, rawBody, TIMESTAMP);
    const resource = new WebhooksResource();

    expect(() =>
      resource.constructEvent(rawBody, header, SECRET, { toleranceSec: Number.MAX_SAFE_INTEGER }),
    ).toThrow(PeableSignatureVerificationError);
  });

  test('rejects a malformed signature header', () => {
    const resource = new WebhooksResource();

    expect(() => resource.constructEvent(RAW_BODY, 'not-a-signature', SECRET)).toThrow(
      PeableSignatureVerificationError,
    );
  });
});

import { test, expect } from "bun:test";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { SsrfRejection, type SafeFetchResult } from "@oxyhq/core/server";
import { verifyWebhook, type PaymentIntent } from "@peable/shared-types";
import {
  buildEvent,
  deliver,
  type SafeFetchFn,
  type WebhookTarget,
} from "../webhookDispatcher";

const TOLERANCE_SEC = 300;

const TARGET: WebhookTarget = {
  url: "https://merchant.example/peable/webhook",
  secret: "whsec_test_secret",
};

const INTENT: PaymentIntent = {
  id: "pi_0000000000000000000000a1",
  object: "payment_intent",
  status: "settled",
  amount: "100000000",
  currency: "FAIR",
  network: "testnet",
  address: "TC8KNvRhFUJUepcCSjBBeLa5HYo4Na11w3",
  merchantId: "merch_1",
  txid: "tx_1",
  confirmations: 2,
  clientSecret: "pi_0000000000000000000000a1_secret_x",
  metadata: {},
  expiresAt: "2026-07-18T00:00:00.000Z",
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
};

// Build a SafeFetchResult backed by a REAL IncomingMessage so `response`
// satisfies the type without a cast, while letting us observe destroy().
function fakeResult(status: number): {
  result: SafeFetchResult;
  wasDestroyed: () => boolean;
} {
  const response = new IncomingMessage(new Socket());
  let destroyed = false;
  response.destroy = (_error?: Error) => {
    destroyed = true;
    return response;
  };
  return {
    result: { response, status, headers: {}, finalUrl: TARGET.url },
    wasDestroyed: () => destroyed,
  };
}

test("delivers a correctly-signed webhook and destroys the response on 2xx", async () => {
  const captured: { body?: string; signature?: string; contentType?: string } = {};
  const { result, wasDestroyed } = fakeResult(200);
  const fakeSafeFetch: SafeFetchFn = async (_url, options) => {
    captured.body = typeof options?.body === "string" ? options.body : undefined;
    captured.signature = options?.headers?.["Peable-Signature"];
    captured.contentType = options?.headers?.["Content-Type"];
    return result;
  };

  const event = buildEvent("payment_intent.settled", INTENT);
  const outcome = await deliver(event, TARGET, { safeFetch: fakeSafeFetch });

  expect(outcome).toEqual({ delivered: true, attempts: 1 });
  expect(captured.contentType).toBe("application/json");
  if (captured.body === undefined || captured.signature === undefined) {
    throw new Error("safeFetch was not called with a body + signature header");
  }
  expect(captured.body).toBe(JSON.stringify(event));
  expect(
    verifyWebhook(
      TARGET.secret,
      captured.body,
      captured.signature,
      TOLERANCE_SEC,
      Math.floor(Date.now() / 1000),
    ),
  ).toBe(true);
  expect(wasDestroyed()).toBe(true);
});

test("retries on 5xx and succeeds on the third attempt", async () => {
  const statuses = [500, 500, 200];
  const destroyChecks: Array<() => boolean> = [];
  let call = 0;
  const fakeSafeFetch: SafeFetchFn = async () => {
    const status = statuses[call] ?? 200;
    call += 1;
    const { result, wasDestroyed } = fakeResult(status);
    destroyChecks.push(wasDestroyed);
    return result;
  };

  const outcome = await deliver(buildEvent("payment_intent.settled", INTENT), TARGET, {
    safeFetch: fakeSafeFetch,
  });

  expect(outcome).toEqual({ delivered: true, attempts: 3 });
  expect(call).toBe(3);
  expect(destroyChecks.every((check) => check())).toBe(true);
});

test("does not retry a 4xx and reports failure", async () => {
  const { result, wasDestroyed } = fakeResult(422);
  let call = 0;
  const fakeSafeFetch: SafeFetchFn = async () => {
    call += 1;
    return result;
  };

  const outcome = await deliver(buildEvent("payment_intent.failed", INTENT), TARGET, {
    safeFetch: fakeSafeFetch,
  });

  expect(outcome).toEqual({ delivered: false, attempts: 1 });
  expect(call).toBe(1);
  expect(wasDestroyed()).toBe(true);
});

test("swallows an SsrfRejection without throwing", async () => {
  const fakeSafeFetch: SafeFetchFn = async () => {
    throw new SsrfRejection("blocked");
  };

  const outcome = await deliver(buildEvent("payment_intent.settled", INTENT), TARGET, {
    safeFetch: fakeSafeFetch,
  });

  expect(outcome).toEqual({ delivered: false, attempts: 1 });
});

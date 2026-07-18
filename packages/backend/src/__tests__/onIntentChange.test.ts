import { test, expect, beforeAll, afterAll, spyOn } from "bun:test";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import type { Server as SocketServer } from "socket.io";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Merchant } from "../models/Merchant";
import { PaymentIntent } from "../models/PaymentIntent";
import { WebhookDelivery } from "../models/WebhookDelivery";
import { onIntentChange } from "../server";
import type { SafeFetchFn } from "../services/webhookDispatcher";

const XPUB =
  "DRKVrRr8WgU4mARJnCLAp77sKJ5h5K79VH8sredx2qPY8BUKogTYqoAXdTAzzvS5MgBDGGWb2Zoa2AwzoLRsbGGkBm1q2r7QSfRYWCizWfvMfPZn";
const ADDRESS = "TC8KNvRhFUJUepcCSjBBeLa5HYo4Na11w3";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Merchant.init();
  await PaymentIntent.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

function fakeIo(): SocketServer {
  return { to: () => ({ emit: () => {} }) } as unknown as SocketServer;
}

function fakeSafeFetchOk(): SafeFetchFn {
  return (async () => {
    const response = new IncomingMessage(new Socket());
    return { response, status: 200, headers: {}, finalUrl: "https://merchant.example/hook" };
  }) as SafeFetchFn;
}

test("onIntentChange persists a WebhookDelivery after a successful delivery", async () => {
  const merchant = await Merchant.create({
    publicId: "merch_test_delivery_log_1",
    oxyAppId: "app_delivery_log",
    environment: "development",
    network: "testnet",
    xpub: XPUB,
    webhookUrl: "https://merchant.example/hook",
    webhookSecret: "whsec_log",
  });
  const intent = await PaymentIntent.create({
    id: "pi_0000000000000000000000d1",
    status: "settled",
    amount: "100000000",
    network: "testnet",
    address: ADDRESS,
    merchantId: merchant.id,
    clientSecret: "pi_0000000000000000000000d1_secret_x",
    idempotencyKey: "idem_delivery_log",
    expiresAt: new Date(Date.now() + 60_000),
  });

  await onIntentChange(fakeIo(), intent, fakeSafeFetchOk());

  const deliveries = await WebhookDelivery.find({ merchantId: merchant.id });
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]?.intentId).toBe(intent.id);
  expect(deliveries[0]?.eventType).toBe("payment_intent.settled");
  expect(deliveries[0]?.delivered).toBe(true);
  expect(deliveries[0]?.attempts).toBe(1);
  expect(deliveries[0]?.lastStatus).toBe("delivered");
});

test("onIntentChange does not throw when persisting the delivery log fails (best-effort, matches deliver()'s own contract)", async () => {
  const merchant = await Merchant.create({
    publicId: "merch_test_delivery_log_2",
    oxyAppId: "app_delivery_log_fail",
    environment: "development",
    network: "testnet",
    xpub: XPUB,
    webhookUrl: "https://merchant.example/hook",
    webhookSecret: "whsec_log_fail",
  });
  const intent = await PaymentIntent.create({
    id: "pi_0000000000000000000000d2",
    status: "settled",
    amount: "100000000",
    network: "testnet",
    address: "TVdQEadb9Yurh3QCBf1vwjZxNySQvHxFmk",
    merchantId: merchant.id,
    clientSecret: "pi_0000000000000000000000d2_secret_y",
    idempotencyKey: "idem_delivery_log_fail",
    expiresAt: new Date(Date.now() + 60_000),
  });

  const createSpy = spyOn(WebhookDelivery, "create").mockRejectedValue(
    new Error("simulated write failure"),
  );
  try {
    await expect(onIntentChange(fakeIo(), intent, fakeSafeFetchOk())).resolves.toBeUndefined();
  } finally {
    createSpy.mockRestore();
  }
});

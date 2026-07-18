import {
  test,
  expect,
  beforeAll,
  afterAll,
  describe,
} from "bun:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import express from "express";
import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { OxyAuthRequest, SafeFetchResult } from "@oxyhq/core/server";
import { Merchant } from "../../models/Merchant";
import { PaymentIntent } from "../../models/PaymentIntent";
import { WebhookDelivery } from "../../models/WebhookDelivery";
import { createWebhookDeliveriesRouter } from "../webhookDeliveries";

const XPUB =
  "DRKVrRr8WgU4mARJnCLAp77sKJ5h5K79VH8sredx2qPY8BUKogTYqoAXdTAzzvS5MgBDGGWb2Zoa2AwzoLRsbGGkBm1q2r7QSfRYWCizWfvMfPZn";
const APP_ID = "app_redeliver";

const stubRequireMerchant: RequestHandler = (req, _res, next) => {
  (req as OxyAuthRequest).serviceApp = {
    appId: APP_ID,
    appName: "t",
    scopes: [],
    credentialId: "c",
    environment: "development",
  };
  next();
};

let mongod: MongoMemoryServer;
let server: Server;
let baseUrl: string;
let merchantId: string;
let intentId: string;
let deliveryId: string;

const capturedFetches: string[] = [];
const fakeSafeFetch = async (url: string): Promise<SafeFetchResult> => {
  capturedFetches.push(url);
  const response = new IncomingMessage(new Socket());
  return { response, status: 200, headers: {}, finalUrl: url };
};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Merchant.init();
  await PaymentIntent.init();

  const merchant = await Merchant.create({
    publicId: "merch_test_redeliver_1",
    oxyAppId: APP_ID,
    environment: "development",
    network: "testnet",
    xpub: XPUB,
    webhookUrl: "https://merchant.example/hook",
    webhookSecret: "whsec_redeliver",
  });
  merchantId = merchant.id;

  const intent = await PaymentIntent.create({
    id: "pi_0000000000000000000000f1",
    status: "settled",
    amount: "100000000",
    network: "testnet",
    address: "TC8KNvRhFUJUepcCSjBBeLa5HYo4Na11w3",
    merchantId: merchant.id,
    clientSecret: "pi_0000000000000000000000f1_secret_x",
    idempotencyKey: "idem_redeliver",
    expiresAt: new Date(Date.now() + 60_000),
  });
  intentId = intent.id;

  const delivery = await WebhookDelivery.create({
    merchantId: merchant.id,
    intentId: intent.id,
    eventId: "evt_0000000000000000000000f1",
    eventType: "payment_intent.settled",
    url: "https://merchant.example/hook",
    attempts: 3,
    delivered: false,
    lastStatus: "failed",
  });
  deliveryId = delivery.id;

  const app = express();
  app.use(express.json());
  app.use(
    createWebhookDeliveriesRouter({
      requireMerchant: stubRequireMerchant,
      safeFetch: fakeSafeFetch,
    }),
  );
  server = app.listen(0);
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await mongoose.disconnect();
  await mongod.stop();
});

describe("POST /v1/webhook_deliveries/:id/redeliver", () => {
  test("redelivers and persists a NEW delivery row", async () => {
    const before = await WebhookDelivery.countDocuments({ merchantId });
    const res = await fetch(`${baseUrl}/v1/webhook_deliveries/${deliveryId}/redeliver`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { delivered: boolean; intentId: string };
    expect(body.delivered).toBe(true);
    expect(body.intentId).toBe(intentId);
    expect(capturedFetches.at(-1)).toBe("https://merchant.example/hook");

    const after = await WebhookDelivery.countDocuments({ merchantId });
    expect(after).toBe(before + 1);
  });

  test("unknown delivery id -> 404", async () => {
    const res = await fetch(
      `${baseUrl}/v1/webhook_deliveries/${new mongoose.Types.ObjectId().toString()}/redeliver`,
      { method: "POST" },
    );
    expect(res.status).toBe(404);
  });

  test("malformed id (not an ObjectId) -> 404, no CastError 500", async () => {
    const res = await fetch(`${baseUrl}/v1/webhook_deliveries/not-an-object-id/redeliver`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  test("a delivery belonging to a different merchant -> 404 (never leaks cross-tenant)", async () => {
    const otherMerchant = await Merchant.create({
      publicId: "merch_test_redeliver_other",
      oxyAppId: "app_redeliver_other",
      environment: "development",
      network: "testnet",
      xpub: XPUB,
    });
    const otherIntent = await PaymentIntent.create({
      id: "pi_0000000000000000000000f2",
      status: "settled",
      amount: "100000000",
      network: "testnet",
      address: "TVdQEadb9Yurh3QCBf1vwjZxNySQvHxFmk",
      merchantId: otherMerchant.id,
      clientSecret: "pi_0000000000000000000000f2_secret_y",
      idempotencyKey: "idem_redeliver_other",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const otherDelivery = await WebhookDelivery.create({
      merchantId: otherMerchant.id,
      intentId: otherIntent.id,
      eventId: "evt_0000000000000000000000f2",
      eventType: "payment_intent.settled",
      url: "https://other.example/hook",
      attempts: 1,
      delivered: true,
      lastStatus: "delivered",
    });

    const res = await fetch(`${baseUrl}/v1/webhook_deliveries/${otherDelivery.id}/redeliver`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });
});

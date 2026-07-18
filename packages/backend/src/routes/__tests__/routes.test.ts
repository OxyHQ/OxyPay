import {
  test,
  expect,
  beforeAll,
  afterAll,
  describe,
} from "bun:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { OxyAuthRequest } from "@oxyhq/core/server";
import { Merchant } from "../../models/Merchant";
import { PaymentIntent } from "../../models/PaymentIntent";
import { createPaymentIntentsRouter } from "../paymentIntents";

// Real TESTNET account xpub for the canonical all-"abandon" + "art" mnemonic
// (m/44'/1'/0' neutered) — public-key-only, cannot spend. Index 0 derives the
// address asserted below.
const XPUB =
  "DRKVrRr8WgU4mARJnCLAp77sKJ5h5K79VH8sredx2qPY8BUKogTYqoAXdTAzzvS5MgBDGGWb2Zoa2AwzoLRsbGGkBm1q2r7QSfRYWCizWfvMfPZn";
const FIRST_ADDRESS = "TC8KNvRhFUJUepcCSjBBeLa5HYo4Na11w3";
const TEST_APP_ID = "app_test";

// Test stub for the merchant auth middleware: bypass real Oxy service tokens by
// populating `req.serviceApp` directly (exactly what `oxyClient.serviceAuth()`
// would do after verifying a token).
const stubRequireMerchant: RequestHandler = (req, _res, next) => {
  (req as OxyAuthRequest).serviceApp = {
    appId: TEST_APP_ID,
    appName: "t",
    scopes: [],
    credentialId: "c",
    environment: "development",
  };
  next();
};

interface IntentResponse {
  id: string;
  object: string;
  status: string;
  amount: string;
  currency: string;
  network: string;
  address: string;
  merchantId: string;
  txid: string | null;
  confirmations: number;
  clientSecret: string;
  metadata: Record<string, string>;
  client_secret?: string;
  error?: { type: string; message: string };
}

let mongod: MongoMemoryServer;
let server: Server;
let baseUrl: string;

async function readJson(res: Response): Promise<IntentResponse> {
  return (await res.json()) as IntentResponse;
}

async function createIntent(
  idempotencyKey: string,
): Promise<{ status: number; body: IntentResponse }> {
  const res = await fetch(`${baseUrl}/v1/payment_intents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      amount: "150000000",
      network: "testnet",
      metadata: { orderId: "o1" },
    }),
  });
  return { status: res.status, body: await readJson(res) };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Merchant.init();
  await PaymentIntent.init();

  await Merchant.create({
    publicId: "merch_test0000000000000001",
    oxyAppId: TEST_APP_ID,
    environment: "development",
    network: "testnet",
    xpub: XPUB,
    webhookUrl: "https://example.test/webhook",
    webhookSecret: "whsec_test",
  });

  const app = express();
  app.use(express.json());
  app.use(
    createPaymentIntentsRouter({ requireMerchant: stubRequireMerchant }),
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

describe("POST /v1/payment_intents", () => {
  test("creates an intent (201) with a pi_ id, derived address and client_secret", async () => {
    const { status, body } = await createIntent("idem-create-1");

    expect(status).toBe(201);
    expect(body.id).toMatch(/^pi_[0-9a-f]{24}$/);
    expect(body.object).toBe("payment_intent");
    expect(body.status).toBe("created");
    expect(body.amount).toBe("150000000");
    expect(body.currency).toBe("FAIR");
    expect(body.network).toBe("testnet");
    expect(body.address).toBe(FIRST_ADDRESS);
    expect(body.metadata.orderId).toBe("o1");
    expect(body.txid).toBeNull();
    expect(typeof body.client_secret).toBe("string");
    expect(body.client_secret?.startsWith(`${body.id}_secret_`)).toBe(true);
    expect(body.client_secret).toBe(body.clientSecret);
  });

  test("replaying the same Idempotency-Key returns the SAME intent, not a new one", async () => {
    const first = await createIntent("idem-replay");
    const second = await createIntent("idem-replay");

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.address).toBe(first.body.address);

    const count = await PaymentIntent.countDocuments({
      idempotencyKey: "idem-replay",
    });
    expect(count).toBe(1);
  });

  test("missing Idempotency-Key → 400", async () => {
    const res = await fetch(`${baseUrl}/v1/payment_intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: "150000000", network: "testnet" }),
    });
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect(body.error?.type).toBe("invalid_request_error");
  });

  test("a non-integer amount → 422", async () => {
    const res = await fetch(`${baseUrl}/v1/payment_intents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "idem-bad-amount",
      },
      body: JSON.stringify({ amount: "1.5", network: "testnet" }),
    });
    expect(res.status).toBe(422);
  });

  test("network mismatched against the merchant's own network -> 422, no address ever derived", async () => {
    const res = await fetch(`${baseUrl}/v1/payment_intents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "idem-network-mismatch",
      },
      body: JSON.stringify({ amount: "150000000", network: "mainnet" }),
    });
    expect(res.status).toBe(422);
    const body = await readJson(res);
    expect(body.error?.type).toBe("invalid_request_error");

    const count = await PaymentIntent.countDocuments({
      idempotencyKey: "idem-network-mismatch",
    });
    expect(count).toBe(0);
  });
});

describe("GET /v1/payment_intents/:id", () => {
  test("returns the merchant's own intent", async () => {
    const created = await createIntent("idem-get");
    const res = await fetch(
      `${baseUrl}/v1/payment_intents/${created.body.id}`,
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.id).toBe(created.body.id);
    expect(body.address).toBe(created.body.address);
  });

  test("unknown id → 404", async () => {
    const res = await fetch(
      `${baseUrl}/v1/payment_intents/pi_does_not_exist`,
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/payment_intents/:id/submit_tx (payer path)", () => {
  test("the right client_secret sets txid and moves to broadcast", async () => {
    const created = await createIntent("idem-submit-ok");
    const res = await fetch(
      `${baseUrl}/v1/payment_intents/${created.body.id}/submit_tx`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_secret: created.body.client_secret,
          txid: "a".repeat(64),
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.txid).toBe("a".repeat(64));
    expect(body.status).toBe("broadcast");
  });

  test("a wrong client_secret → 403 and does not mutate the intent", async () => {
    const created = await createIntent("idem-submit-bad");
    const res = await fetch(
      `${baseUrl}/v1/payment_intents/${created.body.id}/submit_tx`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_secret: "pi_wrong_secret",
          txid: "b".repeat(64),
        }),
      },
    );
    expect(res.status).toBe(403);

    const reloaded = await PaymentIntent.findOne({ id: created.body.id });
    expect(reloaded?.txid).toBeNull();
    expect(reloaded?.status).toBe("created");
  });
});

describe("POST /v1/payment_intents/:id/reject", () => {
  test("moves the intent to rejected", async () => {
    const created = await createIntent("idem-reject");
    const res = await fetch(
      `${baseUrl}/v1/payment_intents/${created.body.id}/reject`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.status).toBe("rejected");
  });
});

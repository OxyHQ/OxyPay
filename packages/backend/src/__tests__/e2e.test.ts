/**
 * End-to-end: the F1 atomic flow across the whole Gateway, wired together.
 *
 *   create → (payer) submit_tx → settlement watcher → settled
 *          → realtime socket event  AND  signed webhook
 *
 * On-chain reads and webhook delivery are stubbed (FairCoin testnet is empty),
 * but every backend layer — routes, models, state machine, watcher, socket,
 * webhook signer/dispatcher — runs for real. Also asserts the non-custody
 * invariant: no private-key/seed field is ever persisted.
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { IncomingMessage } from "node:http";
import { Socket as NetSocket } from "node:net";
import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { io as ioClient } from "socket.io-client";
import type { NetworkType } from "@fairco.in/core";
import type {
  OxyAuthRequest,
  SafeFetchResult,
} from "@oxyhq/core/server";
import { Merchant } from "../models/Merchant";
import { PaymentIntent } from "../models/PaymentIntent";
import { createGateway, type Gateway } from "../server";
import { verifyWebhook } from "../services/webhookSigner";
import type { ExplorerTx } from "../services/explorer";

const XPUB =
  "DRKVrRr8WgU4mARJnCLAp77sKJ5h5K79VH8sredx2qPY8BUKogTYqoAXdTAzzvS5MgBDGGWb2Zoa2AwzoLRsbGGkBm1q2r7QSfRYWCizWfvMfPZn";
const FIRST_ADDRESS = "TC8KNvRhFUJUepcCSjBBeLa5HYo4Na11w3";
const APP_ID = "app_e2e";
const WEBHOOK_SECRET = "whsec_e2e";
const AMOUNT = "150000000";
const TXID = "e2e_reported_txid_0001";

// Stub merchant service-auth (bypass real Oxy tokens).
const stubRequireMerchant: RequestHandler = (req, _res, next) => {
  (req as OxyAuthRequest).serviceApp = {
    appId: APP_ID,
    appName: "e2e",
    scopes: [],
    credentialId: "c",
    environment: "development",
  };
  next();
};

// Stub optional service-auth for the dual-auth GET route (the e2e flow never
// calls it, but `createGateway` still needs a deterministic value independent
// of ambient env vars).
const stubOptionalServiceAuth = (
  _req: unknown,
  _res: unknown,
  next: (err?: Error) => void,
): void => next();

// Permissive socket auth (no Oxy token in test).
const stubSocketAuth = (_socket: unknown, next: (err?: Error) => void): void =>
  next();

// Controllable on-chain reader.
let txResponse: ExplorerTx | null = null;
const stubGetTransaction = async (
  _txid: string,
  _network: NetworkType,
): Promise<ExplorerTx | null> => txResponse;

// Fake SSRF-safe fetch that captures the webhook delivery.
interface CapturedWebhook {
  url: string;
  headers: Record<string, string>;
  body: string;
}
const webhookCalls: CapturedWebhook[] = [];
const fakeSafeFetch = async (
  url: string,
  options?: { headers?: Record<string, string>; body?: string | Buffer },
): Promise<SafeFetchResult> => {
  const body = typeof options?.body === "string" ? options.body : "";
  webhookCalls.push({ url, headers: options?.headers ?? {}, body });
  const response = new IncomingMessage(new NetSocket());
  return { response, status: 200, headers: {}, finalUrl: url };
};

let mongod: MongoMemoryServer;
let gateway: Gateway;
let baseUrl: string;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Merchant.init();
  await PaymentIntent.init();

  await Merchant.create({
    publicId: "merch_test0000000000000001",
    oxyAppId: APP_ID,
    environment: "development",
    network: "testnet",
    xpub: XPUB,
    webhookUrl: "https://merchant.example/oxypay/webhook",
    webhookSecret: WEBHOOK_SECRET,
    requiredConfirmations: 1,
  });

  gateway = createGateway({
    requireMerchant: stubRequireMerchant,
    optionalServiceAuth: stubOptionalServiceAuth,
    socketAuth: stubSocketAuth,
    getTransaction: stubGetTransaction,
    safeFetch: fakeSafeFetch,
  });

  await new Promise<void>((resolve) => {
    gateway.httpServer.listen(0, resolve);
  });
  const address = gateway.httpServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("http server did not bind a port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  gateway.io.close();
  gateway.httpServer.close();
  await mongoose.disconnect();
  await mongod.stop();
});

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
    }),
  ]);
}

test("GET /health is an unauthenticated 200 liveness probe", async () => {
  const res = await fetch(`${baseUrl}/health`);
  expect(res.status).toBe(200);
  expect((await res.json()) as { status: string }).toEqual({ status: "ok" });
});

test("atomic flow: create -> submit_tx -> watcher settles -> socket + webhook", async () => {
  // 1. Merchant creates the charge.
  const createRes = await fetch(`${baseUrl}/v1/payment_intents`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "e2e-1" },
    body: JSON.stringify({ amount: AMOUNT, network: "testnet" }),
  });
  expect(createRes.status).toBe(201);
  expect(createRes.headers.get("Oxy-Pay-Version")).toBe("2026-07-18");
  const created = (await createRes.json()) as {
    id: string;
    address: string;
    status: string;
    client_secret: string;
  };
  expect(created.status).toBe("created");
  expect(created.address).toBe(FIRST_ADDRESS);

  // 2. Payer's wallet opens a realtime channel for this intent.
  const client = ioClient(baseUrl, { transports: ["websocket"], forceNew: true });
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      client.on("connect", () => resolve());
      client.on("connect_error", (err: Error) => reject(err));
    }),
    5000,
    "socket connect",
  );
  const subAck = await withTimeout(
    new Promise<{ ok: boolean }>((resolve) => {
      client.emit(
        "subscribe",
        { intentId: created.id, clientSecret: created.client_secret },
        resolve,
      );
    }),
    5000,
    "subscribe ack",
  );
  expect(subAck.ok).toBe(true);

  const settled = withTimeout(
    new Promise<{ status: string; id: string }>((resolve) => {
      client.on("intent.updated", (payload: { status: string; id: string }) => {
        if (payload.status === "settled") resolve(payload);
      });
    }),
    5000,
    "settled socket event",
  );

  // 3. Payer reports the broadcast txid (self-custody: they signed it).
  const submitRes = await fetch(
    `${baseUrl}/v1/payment_intents/${created.id}/submit_tx`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_secret: created.client_secret, txid: TXID }),
    },
  );
  expect(submitRes.status).toBe(200);
  expect(((await submitRes.json()) as { status: string }).status).toBe(
    "broadcast",
  );

  // 4. The chain now shows the tx paid + confirmed; the watcher reconciles.
  txResponse = {
    txid: TXID,
    confirmations: 1,
    outputs: [{ address: FIRST_ADDRESS, valueSat: BigInt(AMOUNT) }],
  };
  await gateway.watcher.check();

  // 5. The payer's socket received the settled update.
  const event = await settled;
  expect(event.id).toBe(created.id);
  expect(event.status).toBe("settled");

  // 6. The intent is settled in the DB.
  const doc = await PaymentIntent.findOne({ id: created.id });
  expect(doc?.status).toBe("settled");

  // 7. A correctly-signed settled webhook was delivered to the merchant.
  const hook = webhookCalls.at(-1);
  if (!hook) throw new Error("no webhook captured");
  const signature = hook.headers["Oxy-Pay-Signature"];
  if (signature === undefined) throw new Error("webhook missing signature");
  expect(
    verifyWebhook(
      WEBHOOK_SECRET,
      hook.body,
      signature,
      300,
      Math.floor(Date.now() / 1000),
    ),
  ).toBe(true);
  const payload = JSON.parse(hook.body) as {
    type: string;
    data: { object: { status: string } };
  };
  expect(payload.type).toBe("payment_intent.settled");
  expect(payload.data.object.status).toBe("settled");

  // 8. Non-custody invariant: no private-key/seed field was ever persisted.
  const merchantDoc = await Merchant.findOne({ oxyAppId: APP_ID }).lean();
  const intentDoc = await PaymentIntent.findOne({ id: created.id }).lean();
  const persistedKeys = [
    ...Object.keys(merchantDoc ?? {}),
    ...Object.keys(intentDoc ?? {}),
  ];
  const custodyField = persistedKeys.find((k) =>
    /(private|mnemonic|seed|xprv)/i.test(k),
  );
  expect(custodyField).toBeUndefined();

  client.close();
});

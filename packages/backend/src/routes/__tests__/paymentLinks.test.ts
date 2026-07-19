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
import { PaymentLink } from "../../models/PaymentLink";
import { PaymentIntent } from "../../models/PaymentIntent";
import { createPaymentLinksRouter } from "../paymentLinks";

const XPUB =
  "DRKVrRr8WgU4mARJnCLAp77sKJ5h5K79VH8sredx2qPY8BUKogTYqoAXdTAzzvS5MgBDGGWb2Zoa2AwzoLRsbGGkBm1q2r7QSfRYWCizWfvMfPZn";
const APP_ID = "app_paylinks";

const stubRequireMerchant: RequestHandler = (req, _res, next) => {
  (req as OxyAuthRequest).serviceApp = {
    appId: APP_ID,
    appName: "t",
    scopes: ["payments:read", "payments:write"],
    credentialId: "c",
    environment: "development",
  };
  next();
};

// No-op stand-in for the real `createOxyRateLimit` instance — the rate-limit
// budget itself is exercised where it's wired (`server.ts`), not per-route.
const passthroughRateLimit: RequestHandler = (_req, _res, next) => next();

interface PaymentLinkResponse {
  id: string;
  object: string;
  amount: string;
  network: string;
  active: boolean;
  metadata: Record<string, string>;
  successUrl?: string;
  url: string;
  error?: { type: string; message: string };
}

interface PublicPaymentLinkResponse {
  id: string;
  object: string;
  amount: string;
  network: string;
  active: boolean;
  merchant: { name: string; avatarUrl: string | null; description: string | null };
  error?: { type: string; message: string };
}

interface IntentResponse {
  id: string;
  status: string;
  amount: string;
  network: string;
  address: string;
  merchantId: string;
  metadata: Record<string, string>;
  client_secret?: string;
  error?: { type: string; message: string };
}

let mongod: MongoMemoryServer;
let server: Server;
let baseUrl: string;
let merchantId: string;

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Merchant.init();
  await PaymentLink.init();
  await PaymentIntent.init();

  const merchant = await Merchant.create({
    publicId: "merch_test_paylinks_1",
    oxyAppId: APP_ID,
    environment: "development",
    network: "testnet",
    xpub: XPUB,
    displayName: "Paylinks Co",
  });
  merchantId = merchant.id;

  const app = express();
  app.use(express.json());
  app.use(
    createPaymentLinksRouter({
      requireMerchant: stubRequireMerchant,
      publicRateLimit: passthroughRateLimit,
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

describe("POST /v1/payment_links", () => {
  test("creates a link (201) with a link_ id and a checkout.oxy.so URL", async () => {
    const res = await fetch(`${baseUrl}/v1/payment_links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: "200000000",
        network: "testnet",
        metadata: { sku: "sku_1" },
        successUrl: "https://merchant.example/thanks",
      }),
    });
    expect(res.status).toBe(201);
    const body = await readJson<PaymentLinkResponse>(res);
    expect(body.id).toMatch(/^link_[0-9a-f]+$/);
    expect(body.object).toBe("payment_link");
    expect(body.amount).toBe("200000000");
    expect(body.active).toBe(true);
    expect(body.metadata).toEqual({ sku: "sku_1" });
    expect(body.successUrl).toBe("https://merchant.example/thanks");
    expect(body.url).toBe(`https://checkout.oxy.so/l/${body.id}`);
  });

  test("a network that doesn't match the merchant's configured network -> 422", async () => {
    const res = await fetch(`${baseUrl}/v1/payment_links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: "100000000", network: "mainnet" }),
    });
    expect(res.status).toBe(422);
    const body = await readJson<PaymentLinkResponse>(res);
    expect(body.error?.type).toBe("invalid_request_error");
  });

  test("no service app credentials -> 401", async () => {
    const app = express();
    app.use(express.json());
    app.use(
      createPaymentLinksRouter({
        requireMerchant: (_req, _res, next) => next(),
        publicRateLimit: passthroughRateLimit,
      }),
    );
    const noAuthServer = app.listen(0);
    const noAuthAddress = noAuthServer.address() as AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${noAuthAddress.port}/v1/payment_links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: "100000000", network: "testnet" }),
      });
      expect(res.status).toBe(401);
    } finally {
      await new Promise<void>((resolve, reject) => {
        noAuthServer.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  test("a credential without payments:write -> 403", async () => {
    const readOnly: RequestHandler = (req, _res, next) => {
      (req as OxyAuthRequest).serviceApp = {
        appId: APP_ID,
        appName: "t",
        scopes: ["payments:read"],
        credentialId: "c",
        environment: "development",
      };
      next();
    };
    const app = express();
    app.use(express.json());
    app.use(
      createPaymentLinksRouter({
        requireMerchant: readOnly,
        publicRateLimit: passthroughRateLimit,
      }),
    );
    const readOnlyServer = app.listen(0);
    const readOnlyAddress = readOnlyServer.address() as AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${readOnlyAddress.port}/v1/payment_links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: "100000000", network: "testnet" }),
      });
      expect(res.status).toBe(403);
    } finally {
      await new Promise<void>((resolve, reject) => {
        readOnlyServer.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});

describe("GET/PATCH /v1/payment_links (merchant CRUD)", () => {
  test("list -> retrieve -> patch round trip", async () => {
    const createRes = await fetch(`${baseUrl}/v1/payment_links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: "50000000", network: "testnet" }),
    });
    const created = await readJson<PaymentLinkResponse>(createRes);

    const listRes = await fetch(`${baseUrl}/v1/payment_links`);
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { object: string; data: PaymentLinkResponse[] };
    expect(list.object).toBe("list");
    expect(list.data.some((link) => link.id === created.id)).toBe(true);

    const getRes = await fetch(`${baseUrl}/v1/payment_links/${created.id}`);
    expect(getRes.status).toBe(200);
    const fetched = await readJson<PaymentLinkResponse>(getRes);
    expect(fetched.id).toBe(created.id);

    const patchRes = await fetch(`${baseUrl}/v1/payment_links/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: false, metadata: { note: "paused" } }),
    });
    expect(patchRes.status).toBe(200);
    const patched = await readJson<PaymentLinkResponse>(patchRes);
    expect(patched.active).toBe(false);
    expect(patched.metadata).toEqual({ note: "paused" });
    // amount/network are never accepted by PATCH — immutable once shared.
    expect(patched.amount).toBe(created.amount);
  });

  test("PATCH ignores amount/network even if sent (whitelist, not just unvalidated passthrough)", async () => {
    const createRes = await fetch(`${baseUrl}/v1/payment_links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: "77000000", network: "testnet" }),
    });
    const created = await readJson<PaymentLinkResponse>(createRes);

    const patchRes = await fetch(`${baseUrl}/v1/payment_links/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: "999999999", network: "mainnet" }),
    });
    expect(patchRes.status).toBe(200);
    const patched = await readJson<PaymentLinkResponse>(patchRes);
    expect(patched.amount).toBe("77000000");
    expect(patched.network).toBe("testnet");
  });

  test("unknown id -> 404", async () => {
    const res = await fetch(`${baseUrl}/v1/payment_links/link_doesnotexist`);
    expect(res.status).toBe(404);
  });

  test("a link belonging to a different merchant -> 404 (never leaks cross-tenant)", async () => {
    const otherMerchant = await Merchant.create({
      publicId: "merch_test_paylinks_other",
      oxyAppId: "app_paylinks_other",
      environment: "development",
      network: "testnet",
      xpub: XPUB,
    });
    const otherLink = await PaymentLink.create({
      publicId: "link_other_owner",
      merchantId: otherMerchant.id,
      oxyAppId: otherMerchant.oxyAppId,
      environment: otherMerchant.environment,
      amount: "10000000",
      network: "testnet",
      active: true,
      metadata: new Map(),
    });
    const res = await fetch(`${baseUrl}/v1/payment_links/${otherLink.publicId}`);
    expect(res.status).toBe(404);
  });
});

describe("GET /v1/payment_links/:id/public", () => {
  test("returns merchant display, never metadata/successUrl/internal ids", async () => {
    const link = await PaymentLink.create({
      publicId: "link_public_display",
      merchantId,
      oxyAppId: APP_ID,
      environment: "development",
      amount: "300000000",
      network: "testnet",
      active: true,
      metadata: new Map([["secretNote", "should not leak"]]),
      successUrl: "https://merchant.example/private-thanks",
    });

    const res = await fetch(`${baseUrl}/v1/payment_links/${link.publicId}/public`);
    expect(res.status).toBe(200);
    const body = await readJson<PublicPaymentLinkResponse>(res);
    expect(body).toEqual({
      id: "link_public_display",
      object: "payment_link",
      amount: "300000000",
      network: "testnet",
      active: true,
      merchant: {
        name: "Paylinks Co",
        avatarUrl: null,
        description: null,
      },
    });
    expect(body).not.toHaveProperty("metadata");
    expect(body).not.toHaveProperty("successUrl");
  });

  test("an inactive link still resolves (200, active:false) so the page can show a disabled state", async () => {
    const link = await PaymentLink.create({
      publicId: "link_public_inactive",
      merchantId,
      oxyAppId: APP_ID,
      environment: "development",
      amount: "10000000",
      network: "testnet",
      active: false,
      metadata: new Map(),
    });

    const res = await fetch(`${baseUrl}/v1/payment_links/${link.publicId}/public`);
    expect(res.status).toBe(200);
    const body = await readJson<PublicPaymentLinkResponse>(res);
    expect(body.active).toBe(false);
  });

  test("unknown link id -> 404", async () => {
    const res = await fetch(`${baseUrl}/v1/payment_links/link_doesnotexist/public`);
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/payment_links/:id/payment_intent", () => {
  test("mints a fresh intent bound to the link's merchant + amount + network, ignoring any caller override", async () => {
    const link = await PaymentLink.create({
      publicId: "link_mint_ok",
      merchantId,
      oxyAppId: APP_ID,
      environment: "development",
      amount: "123000000",
      network: "testnet",
      active: true,
      metadata: new Map([["orderId", "o_mint"]]),
    });

    const res = await fetch(`${baseUrl}/v1/payment_links/${link.publicId}/payment_intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // A public caller may never override amount/network/merchant — these
      // must be silently ignored, not merely rejected.
      body: JSON.stringify({ amount: "1", network: "mainnet", merchantId: "merch_other" }),
    });
    expect(res.status).toBe(201);
    const body = await readJson<IntentResponse>(res);
    expect(body.amount).toBe("123000000");
    expect(body.network).toBe("testnet");
    expect(body.merchantId).toBe(merchantId);
    expect(body.metadata).toEqual({ orderId: "o_mint" });
    expect(body.status).toBe("created");
    expect(typeof body.address).toBe("string");
    expect(body.client_secret).toStartWith(`${body.id}_secret_`);
  });

  test("each mint call creates a DISTINCT intent (server always mints fresh; reuse-if-open is a page-layer concern)", async () => {
    const link = await PaymentLink.create({
      publicId: "link_mint_fresh_each_time",
      merchantId,
      oxyAppId: APP_ID,
      environment: "development",
      amount: "5000000",
      network: "testnet",
      active: true,
      metadata: new Map(),
    });

    const first = await readJson<IntentResponse>(
      await fetch(`${baseUrl}/v1/payment_links/${link.publicId}/payment_intent`, { method: "POST" }),
    );
    const second = await readJson<IntentResponse>(
      await fetch(`${baseUrl}/v1/payment_links/${link.publicId}/payment_intent`, { method: "POST" }),
    );
    expect(first.id).not.toBe(second.id);
  });

  test("an inactive link -> 422, mints nothing", async () => {
    const link = await PaymentLink.create({
      publicId: "link_mint_inactive",
      merchantId,
      oxyAppId: APP_ID,
      environment: "development",
      amount: "5000000",
      network: "testnet",
      active: false,
      metadata: new Map(),
    });

    const before = await PaymentIntent.countDocuments({ merchantId });
    const res = await fetch(`${baseUrl}/v1/payment_links/${link.publicId}/payment_intent`, {
      method: "POST",
    });
    expect(res.status).toBe(422);
    const after = await PaymentIntent.countDocuments({ merchantId });
    expect(after).toBe(before);
  });

  test("unknown link id -> 404", async () => {
    const res = await fetch(`${baseUrl}/v1/payment_links/link_doesnotexist/payment_intent`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });
});

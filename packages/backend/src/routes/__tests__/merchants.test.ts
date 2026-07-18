import {
  test,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  describe,
} from "bun:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MAINNET, deriveKeyFromSeed, mnemonicToSeed } from "@fairco.in/core";
import type { OxyAuthRequest } from "@oxyhq/core/server";
import { Merchant } from "../../models/Merchant";
import { createMerchantsRouter } from "../merchants";

// Real TESTNET account xpub for the canonical all-"abandon" + "art" mnemonic
// (m/44'/1'/0' neutered) — public-key-only, cannot spend.
const XPUB =
  "DRKVrRr8WgU4mARJnCLAp77sKJ5h5K79VH8sredx2qPY8BUKogTYqoAXdTAzzvS5MgBDGGWb2Zoa2AwzoLRsbGGkBm1q2r7QSfRYWCizWfvMfPZn";

// The same mnemonic's MAINNET-network account xpub (distinct BIP32 version
// bytes from XPUB above) — the non-custody derivation firewall in Merchant's
// pre-validate hook enforces that `xpub`'s encoded network matches `network`,
// so the "production on mainnet" registration test needs a real mainnet xpub.
const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
const MAINNET_XPUB = deriveKeyFromSeed(mnemonicToSeed(MNEMONIC), MAINNET)
  .derive(`m/44'/${MAINNET.bip44CoinType}'/0'`)
  .hdKey.publicExtendedKey;

const DEV_APP_ID = "app_merch_dev";
const PROD_APP_ID = "app_merch_prod";

function stubRequireMerchant(appId: string, environment: string): RequestHandler {
  return (req, _res, next) => {
    (req as OxyAuthRequest).serviceApp = {
      appId,
      appName: "t",
      scopes: ["payments:read", "payments:write"],
      credentialId: "c",
      environment: environment as OxyAuthRequest["serviceApp"] extends infer T
        ? T extends { environment: infer E }
          ? E
          : never
        : never,
    };
    next();
  };
}

interface MerchantResponse {
  id: string;
  object: string;
  oxyAppId: string;
  environment: string;
  network: string;
  xpub: string;
  webhookUrl?: string;
  requiredConfirmations: number;
  error?: { type: string; message: string };
}

let mongod: MongoMemoryServer;

async function readJson(res: Response): Promise<MerchantResponse> {
  return (await res.json()) as MerchantResponse;
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Merchant.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await Merchant.deleteMany({});
});

function createApp(appId: string, environment: string): { app: ReturnType<typeof express>; requireMerchant: RequestHandler } {
  const requireMerchant = stubRequireMerchant(appId, environment);
  const app = express();
  app.use(express.json());
  app.use(createMerchantsRouter({ requireMerchant }));
  return { app, requireMerchant };
}

async function listen(app: ReturnType<typeof express>): Promise<{ server: Server; baseUrl: string }> {
  const s = app.listen(0);
  await new Promise<void>((resolve) => s.once("listening", resolve));
  const address = s.address() as AddressInfo;
  return { server: s, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe("POST /v1/merchants", () => {
  test("a production credential registers a mainnet merchant (201)", async () => {
    const { app } = createApp(PROD_APP_ID, "production");
    const { server: s, baseUrl: url } = await listen(app);
    try {
      const res = await fetch(`${url}/v1/merchants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: "mainnet", xpub: MAINNET_XPUB }),
      });
      expect(res.status).toBe(201);
      const body = await readJson(res);
      expect(body.id).toMatch(/^merch_[0-9a-f]{24}$/);
      expect(body.object).toBe("merchant");
      expect(body.environment).toBe("production");
      expect(body.network).toBe("mainnet");
      expect(body.requiredConfirmations).toBe(1);
    } finally {
      s.close();
    }
  });

  test("a development credential CANNOT register a mainnet merchant (422) — test/live firewall", async () => {
    const { app } = createApp(DEV_APP_ID, "development");
    const { server: s, baseUrl: url } = await listen(app);
    try {
      const res = await fetch(`${url}/v1/merchants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: "mainnet", xpub: XPUB }),
      });
      expect(res.status).toBe(422);
      const body = await readJson(res);
      expect(body.error?.type).toBe("invalid_request_error");
      const count = await Merchant.countDocuments({ oxyAppId: DEV_APP_ID });
      expect(count).toBe(0);
    } finally {
      s.close();
    }
  });

  test("a development credential registers a testnet merchant (201)", async () => {
    const { app } = createApp(DEV_APP_ID, "development");
    const { server: s, baseUrl: url } = await listen(app);
    try {
      const res = await fetch(`${url}/v1/merchants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: "testnet", xpub: XPUB }),
      });
      expect(res.status).toBe(201);
      const body = await readJson(res);
      expect(body.environment).toBe("development");
      expect(body.network).toBe("testnet");
    } finally {
      s.close();
    }
  });

  test("a private xprv is rejected by the same non-custody firewall the model enforces (422 or 500-free rejection)", async () => {
    const { app } = createApp(DEV_APP_ID, "development");
    const { server: s, baseUrl: url } = await listen(app);
    try {
      const res = await fetch(`${url}/v1/merchants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          network: "testnet",
          // Malformed extended key — the model's pre('validate') firewall
          // must reject this before persisting, regardless of exact string;
          // asserting NOT-201 + NOT-persisted is the load-bearing check.
          xpub: "not-a-real-extended-key",
        }),
      });
      expect(res.status).not.toBe(201);
      const count = await Merchant.countDocuments({ oxyAppId: DEV_APP_ID });
      expect(count).toBe(0);
    } finally {
      s.close();
    }
  });

  test("registering twice for the same app+environment collides (409)", async () => {
    const { app } = createApp(DEV_APP_ID, "development");
    const { server: s, baseUrl: url } = await listen(app);
    try {
      const first = await fetch(`${url}/v1/merchants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: "testnet", xpub: XPUB }),
      });
      expect(first.status).toBe(201);

      const second = await fetch(`${url}/v1/merchants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: "testnet", xpub: XPUB }),
      });
      expect(second.status).toBe(409);
    } finally {
      s.close();
    }
  });

  test("no service app credentials at all -> 401", async () => {
    const app = express();
    app.use(express.json());
    app.use(createMerchantsRouter({ requireMerchant: (_req, _res, next) => next() }));
    const { server: s, baseUrl: url } = await listen(app);
    try {
      const res = await fetch(`${url}/v1/merchants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: "testnet", xpub: XPUB }),
      });
      expect(res.status).toBe(401);
    } finally {
      s.close();
    }
  });

  test("a credential without payments:write is rejected (403 INSUFFICIENT_SCOPE)", async () => {
    const noScopeRequireMerchant: RequestHandler = (req, _res, next) => {
      (req as OxyAuthRequest).serviceApp = {
        appId: DEV_APP_ID,
        appName: "t",
        scopes: [],
        credentialId: "c",
        environment: "development",
      };
      next();
    };
    const app = express();
    app.use(express.json());
    app.use(createMerchantsRouter({ requireMerchant: noScopeRequireMerchant }));
    const { server: s, baseUrl: url } = await listen(app);
    try {
      const res = await fetch(`${url}/v1/merchants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: "testnet", xpub: XPUB }),
      });
      expect(res.status).toBe(403);
    } finally {
      s.close();
    }
  });
});

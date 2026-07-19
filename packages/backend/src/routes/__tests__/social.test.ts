import { test, expect, beforeAll, afterAll, beforeEach, describe, mock } from "bun:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import type { OxyAuthRequest } from "@oxyhq/core/server";
import { oxyClient as realOxyClient, type User } from "@oxyhq/core";
import type { DidDocument } from "@oxyhq/contracts";
import { SocialReceiveCursor } from "../../models/SocialReceiveCursor";
import { SocialSendAttribution } from "../../models/SocialSendAttribution";

const IDENTITY_PUB_A_UNCOMPRESSED_HEX =
  "046a04ab98d9e4774ad806e302dddeb63bea16b5cb5f223ee77478e861bb583eb336b6fbcb60b5b3d4f1551ac45e5ffc4936466e7d98f6c7c0ec736539f74691a6";

const PROFILES: Record<string, { id: string; username: string }> = {
  alice: { id: "user_alice", username: "alice" },
  keylessbob: { id: "user_keylessbob", username: "keylessbob" },
};

function didFor(userId: string): DidDocument {
  const hasKey = userId !== "user_keylessbob";
  return {
    "@context": [],
    id: `did:web:oxy.so:u:${userId}`,
    controller: [],
    verificationMethod: hasKey
      ? [
          {
            id: `did:web:oxy.so:u:${userId}#key-1`,
            type: "EcdsaSecp256k1VerificationKey2019",
            controller: `did:web:oxy.so:u:${userId}`,
            publicKeyHex: IDENTITY_PUB_A_UNCOMPRESSED_HEX,
          },
        ]
      : [],
    authentication: [],
    assertionMethod: [],
    alsoKnownAs: [],
    service: [],
  };
}

const getProfileByUsernameMock = mock(async (username: string) => {
  const profile = PROFILES[username];
  if (!profile) throw new Error("not found");
  return profile as unknown as User;
});
const resolveDidMock = mock(async (userId: string) => didFor(userId));

// `mock.module` replaces `@oxyhq/core` process-wide for the rest of this bun
// test run, including for OTHER test files whose `oxyClient` binding resolves
// after this one applies. Wrap the REAL `oxyClient` in a `Proxy` that only
// intercepts the two methods this route needs and forwards everything else
// (`serviceAuth`, `auth`, ...) to the real instance — `serviceAuthWiring.test.ts`
// and `merchants.test.ts` call those and must keep working regardless of file
// run order. Methods are bound to `target` (the real instance) rather than
// invoked through the proxy so any internal state/private fields they close
// over stay intact.
const mockedOxyClient = new Proxy(realOxyClient, {
  get(target, prop, receiver) {
    if (prop === "getProfileByUsername") return getProfileByUsernameMock;
    if (prop === "resolveDid") return resolveDidMock;
    const value = Reflect.get(target, prop, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

mock.module("@oxyhq/core", () => ({
  oxyClient: mockedOxyClient,
}));

const { createSocialRouter } = await import("../social");

const TEST_SENDER_ID = "user_test_sender";
const stubRequireOxyUser: RequestHandler = (req, _res, next) => {
  (req as OxyAuthRequest).userId = TEST_SENDER_ID;
  next();
};

let mongod: MongoMemoryServer;
let server: Server;
let baseUrl: string;

interface NextAddressResponse {
  address?: string;
  index?: number;
  error?: { type: string; message: string };
}

async function postNextAddress(
  username: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: NextAddressResponse }> {
  const res = await fetch(`${baseUrl}/v1/social/${username}/next_address`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as NextAddressResponse };
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await SocialReceiveCursor.init();
  await SocialSendAttribution.init();

  const app = express();
  app.use(express.json());
  app.use(createSocialRouter({ requireOxyUser: stubRequireOxyUser }));

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

beforeEach(async () => {
  await SocialReceiveCursor.deleteMany({});
  await SocialSendAttribution.deleteMany({});
});

describe("POST /v1/social/:username/next_address", () => {
  test("reserves a fresh address and records the attribution", async () => {
    const { status, body } = await postNextAddress("alice", { network: "testnet" });

    expect(status).toBe(200);
    expect(body.index).toBe(1);
    expect(body.address).toBe("TERWsvgi5BFcdDKgpM1PsHMqenLuGggZqQ");

    const attribution = await SocialSendAttribution.findOne({ address: body.address });
    expect(attribution?.senderUserId).toBe(TEST_SENDER_ID);
    expect(attribution?.recipientUserId).toBe("user_alice");
    expect(attribution?.index).toBe(1);
  });

  test("second call for the same recipient reserves the next index", async () => {
    await postNextAddress("alice", { network: "testnet" });
    const { body } = await postNextAddress("alice", { network: "testnet" });
    expect(body.index).toBe(2);
  });

  test("404s for an unknown username", async () => {
    const { status, body } = await postNextAddress("nobody", { network: "testnet" });
    expect(status).toBe(404);
    expect(body.error?.type).toBe("invalid_request_error");
  });

  test("409s with type keyless_recipient for a keyless recipient", async () => {
    const { status, body } = await postNextAddress("keylessbob", { network: "testnet" });
    expect(status).toBe(409);
    expect(body.error?.type).toBe("keyless_recipient");
  });

  test("422s on a malformed network field", async () => {
    const { status, body } = await postNextAddress("alice", { network: "regtest" });
    expect(status).toBe(422);
    expect(body.error?.type).toBe("invalid_request_error");
  });
});

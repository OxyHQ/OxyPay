import { test, expect, beforeAll, afterAll, beforeEach, mock } from "bun:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { oxyClient as realOxyClient, type User } from "@oxyhq/core";
import { PaymentIntent } from "../../models/PaymentIntent";
import { Merchant } from "../../models/Merchant";
import { SocialSendAttribution } from "../../models/SocialSendAttribution";

const XPUB =
  "DRKVrRr8WgU4mARJnCLAp77sKJ5h5K79VH8sredx2qPY8BUKogTYqoAXdTAzzvS5MgBDGGWb2Zoa2AwzoLRsbGGkBm1q2r7QSfRYWCizWfvMfPZn";

function userProfile(id: string, username: string, displayName: string): User {
  return {
    id,
    publicKey: "pub_" + id,
    username,
    avatar: `file_${id}`,
    name: { displayName },
  } as unknown as User;
}

const getUsersByIdsMock = mock(async (ids: string[]) =>
  ids
    .map((id) => {
      if (id === "user_alice") return userProfile("user_alice", "alice", "Alice");
      if (id === "user_bob") return userProfile("user_bob", "bob", "Bob");
      return null;
    })
    .filter((u): u is User => u !== null),
);

// `mock.module` replaces `@oxyhq/core` process-wide for the rest of this bun
// test run, including for OTHER test files whose `oxyClient` binding resolves
// after this one applies. Wrap the REAL `oxyClient` in a `Proxy` that only
// intercepts `getUsersByIds` and forwards everything else (`serviceAuth`,
// `auth`, `getProfileByUsername`, `resolveDid`, ...) to the real instance,
// bound to it — other route/service test files (`serviceAuthWiring.test.ts`,
// `merchants.test.ts`, `routes/__tests__/social.test.ts`,
// `services/__tests__/socialReceive.test.ts`) call those and must keep
// working regardless of bun's file execution order.
const mockedOxyClient = new Proxy(realOxyClient, {
  get(target, prop, receiver) {
    if (prop === "getUsersByIds") return getUsersByIdsMock;
    const value = Reflect.get(target, prop, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

mock.module("@oxyhq/core", () => ({
  oxyClient: mockedOxyClient,
}));

const { enrichAddresses, ENRICH_MAX_ADDRESSES } = await import("../enrichment");

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await PaymentIntent.init();
  await Merchant.init();
  await SocialSendAttribution.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await PaymentIntent.deleteMany({});
  await Merchant.deleteMany({});
  await SocialSendAttribution.deleteMany({});
  getUsersByIdsMock.mockClear();
});

test("ENRICH_MAX_ADDRESSES is 50", () => {
  expect(ENRICH_MAX_ADDRESSES).toBe(50);
});

test("an address with no PaymentIntent or attribution resolves to unknown", async () => {
  const result = await enrichAddresses(["TUnknownAddr"], "user_viewer");
  expect(result).toEqual({ TUnknownAddr: { kind: "unknown" } });
});

test("a merchant PaymentIntent address resolves to kind: merchant with the Merchant's display fields", async () => {
  const merchant = await Merchant.create({
    publicId: "merch_test0000000000000001",
    oxyAppId: "app_shop",
    environment: "development",
    network: "testnet",
    xpub: XPUB,
    displayName: "Mercaria",
    avatarFileId: "file_mercaria",
    description: "Marketplace",
  });
  await PaymentIntent.create({
    id: "pi_merchant_1",
    status: "settled",
    amount: "1000000",
    network: "testnet",
    address: "TMerchantAddr1",
    merchantId: merchant.id,
    clientSecret: "pi_merchant_1_secret_x",
    idempotencyKey: "idem_1",
    expiresAt: new Date(Date.now() + 60_000),
  });

  const result = await enrichAddresses(["TMerchantAddr1"], "user_viewer");
  expect(result.TMerchantAddr1).toEqual({
    kind: "merchant",
    displayName: "Mercaria",
    avatarFileId: "file_mercaria",
    description: "Marketplace",
  });
});

test("an outgoing social send resolves to kind: user with the RECIPIENT's identity, from the sender's view", async () => {
  await SocialSendAttribution.create({
    address: "TSocialAddr1",
    network: "testnet",
    senderUserId: "user_viewer",
    recipientUserId: "user_alice",
    index: 1,
  });

  const result = await enrichAddresses(["TSocialAddr1"], "user_viewer");
  expect(result.TSocialAddr1).toEqual({
    kind: "user",
    displayName: "Alice",
    avatarFileId: "file_user_alice",
    username: "alice",
  });
});

test("an incoming social receive resolves to kind: user with the SENDER's identity, from the recipient's view", async () => {
  await SocialSendAttribution.create({
    address: "TSocialAddr2",
    network: "testnet",
    senderUserId: "user_bob",
    recipientUserId: "user_viewer",
    index: 1,
  });

  const result = await enrichAddresses(["TSocialAddr2"], "user_viewer");
  expect(result.TSocialAddr2).toEqual({
    kind: "user",
    displayName: "Bob",
    avatarFileId: "file_user_bob",
    username: "bob",
  });
});

test("an attribution the viewer was NOT party to resolves to unknown (no counterparty leak)", async () => {
  await SocialSendAttribution.create({
    address: "TSocialAddr3",
    network: "testnet",
    senderUserId: "user_alice",
    recipientUserId: "user_bob",
    index: 1,
  });

  const result = await enrichAddresses(["TSocialAddr3"], "user_viewer");
  expect(result.TSocialAddr3).toEqual({ kind: "unknown" });
});

test("a batch mixes merchant, social, and unknown results correctly", async () => {
  const merchant = await Merchant.create({
    publicId: "merch_test0000000000000002",
    oxyAppId: "app_mixed",
    environment: "development",
    network: "testnet",
    xpub: XPUB,
    displayName: "Shop",
  });
  await PaymentIntent.create({
    id: "pi_mixed_1",
    status: "settled",
    amount: "1000000",
    network: "testnet",
    address: "TMixedMerchant",
    merchantId: merchant.id,
    clientSecret: "pi_mixed_1_secret_x",
    idempotencyKey: "idem_mixed_1",
    expiresAt: new Date(Date.now() + 60_000),
  });
  await SocialSendAttribution.create({
    address: "TMixedSocial",
    network: "testnet",
    senderUserId: "user_viewer",
    recipientUserId: "user_alice",
    index: 1,
  });

  const result = await enrichAddresses(
    ["TMixedMerchant", "TMixedSocial", "TMixedUnknown"],
    "user_viewer",
  );
  expect(result.TMixedMerchant?.kind).toBe("merchant");
  expect(result.TMixedSocial?.kind).toBe("user");
  expect(result.TMixedUnknown?.kind).toBe("unknown");
});

test("degrades to unknown when getUsersByIds cannot resolve the counterparty profile", async () => {
  await SocialSendAttribution.create({
    address: "TSocialGone",
    network: "testnet",
    senderUserId: "user_viewer",
    recipientUserId: "user_deleted",
    index: 1,
  });

  const result = await enrichAddresses(["TSocialGone"], "user_viewer");
  expect(result.TSocialGone).toEqual({ kind: "unknown" });
});

test("an empty address list resolves to an empty result without calling getUsersByIds", async () => {
  const result = await enrichAddresses([], "user_viewer");
  expect(result).toEqual({});
  expect(getUsersByIdsMock).not.toHaveBeenCalled();
});

test("a display name falls back to the normalized handle when the profile has no name.displayName", async () => {
  getUsersByIdsMock.mockImplementationOnce(async (ids: string[]) =>
    ids
      .filter((id) => id === "user_nodisplay")
      .map(
        (id) =>
          ({
            id,
            publicKey: "pub_" + id,
            username: "nodisplay",
            avatar: `file_${id}`,
            name: {},
          }) as unknown as User,
      ),
  );
  await SocialSendAttribution.create({
    address: "TSocialNoDisplay",
    network: "testnet",
    senderUserId: "user_viewer",
    recipientUserId: "user_nodisplay",
    index: 1,
  });

  const result = await enrichAddresses(["TSocialNoDisplay"], "user_viewer");
  expect(result.TSocialNoDisplay).toEqual({
    kind: "user",
    displayName: "nodisplay",
    avatarFileId: "file_user_nodisplay",
    username: "nodisplay",
  });
});

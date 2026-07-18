import { test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { hexToBytes, getNetwork, deriveSocialReceiveAddress } from "@fairco.in/core";
import { SocialReceiveCursor } from "../SocialReceiveCursor";

// Same pinned identity used by @fairco.in/core's social-receive.test.ts.
const IDENTITY_PUB_A_UNCOMPRESSED = hexToBytes(
  "046a04ab98d9e4774ad806e302dddeb63bea16b5cb5f223ee77478e861bb583eb336b6fbcb60b5b3d4f1551ac45e5ffc4936466e7d98f6c7c0ec736539f74691a6",
);

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await SocialReceiveCursor.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await SocialReceiveCursor.deleteMany({});
});

// oxyClient.resolveDid is mocked at the module level for the service test
// below (Step-8 file); this file exercises ONLY the model + the pure address
// math, so it needs no network mock.
test("SocialReceiveCursor defaults nextDerivationIndex to 1 (index 0 is never reserved)", async () => {
  const cursor = await SocialReceiveCursor.create({
    oxyUserId: "user_1",
    network: "testnet",
  });
  expect(cursor.nextDerivationIndex).toBe(1);
});

test("(oxyUserId, network) is unique", async () => {
  await SocialReceiveCursor.create({ oxyUserId: "user_2", network: "testnet" });
  await expect(
    SocialReceiveCursor.create({ oxyUserId: "user_2", network: "testnet" }),
  ).rejects.toThrow();
});

test("the same user can have independent cursors per network", async () => {
  await SocialReceiveCursor.create({ oxyUserId: "user_3", network: "testnet" });
  const mainnetCursor = await SocialReceiveCursor.create({
    oxyUserId: "user_3",
    network: "mainnet",
  });
  expect(mainnetCursor.nextDerivationIndex).toBe(1);
});

test("sanity: deriveSocialReceiveAddress(pubkey, 1, testnet) matches the pinned vector", () => {
  const network = getNetwork("testnet");
  expect(deriveSocialReceiveAddress(IDENTITY_PUB_A_UNCOMPRESSED, 1, network)).toBe(
    "TERWsvgi5BFcdDKgpM1PsHMqenLuGggZqQ",
  );
});

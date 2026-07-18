import { test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { SocialSendAttribution } from "../SocialSendAttribution";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await SocialSendAttribution.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await SocialSendAttribution.deleteMany({});
});

test("records a sender -> recipient attribution for a social-receive address", async () => {
  const row = await SocialSendAttribution.create({
    address: "TERWsvgi5BFcdDKgpM1PsHMqenLuGggZqQ",
    network: "testnet",
    senderUserId: "user_sender",
    recipientUserId: "user_recipient",
    index: 1,
  });

  expect(row.senderUserId).toBe("user_sender");
  expect(row.recipientUserId).toBe("user_recipient");
  expect(row.index).toBe(1);
});

test("(address, network) is unique — a reused address collides", async () => {
  await SocialSendAttribution.create({
    address: "TERWsvgi5BFcdDKgpM1PsHMqenLuGggZqQ",
    network: "testnet",
    senderUserId: "user_a",
    recipientUserId: "user_b",
    index: 1,
  });

  await expect(
    SocialSendAttribution.create({
      address: "TERWsvgi5BFcdDKgpM1PsHMqenLuGggZqQ",
      network: "testnet",
      senderUserId: "user_c",
      recipientUserId: "user_d",
      index: 7,
    }),
  ).rejects.toThrow();
});

test("the same address string is independent across networks", async () => {
  await SocialSendAttribution.create({
    address: "TERWsvgi5BFcdDKgpM1PsHMqenLuGggZqQ",
    network: "testnet",
    senderUserId: "user_a",
    recipientUserId: "user_b",
    index: 1,
  });

  const mainnetRow = await SocialSendAttribution.create({
    address: "TERWsvgi5BFcdDKgpM1PsHMqenLuGggZqQ",
    network: "mainnet",
    senderUserId: "user_e",
    recipientUserId: "user_f",
    index: 1,
  });

  expect(mainnetRow.network).toBe("mainnet");
});

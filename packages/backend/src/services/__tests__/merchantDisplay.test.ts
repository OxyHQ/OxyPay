import { test, expect, beforeAll, afterAll } from "bun:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Merchant } from "../../models/Merchant";
import { resolveMerchantDisplay } from "../merchantDisplay";

const XPUB =
  "DRKVrRr8WgU4mARJnCLAp77sKJ5h5K79VH8sredx2qPY8BUKogTYqoAXdTAzzvS5MgBDGGWb2Zoa2AwzoLRsbGGkBm1q2r7QSfRYWCizWfvMfPZn";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Merchant.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test("resolves displayName + avatarUrl + description when all identity fields are set", async () => {
  const merchant = await Merchant.create({
    publicId: "merch_test_display_1",
    oxyAppId: "app_display_1",
    environment: "development",
    network: "testnet",
    xpub: XPUB,
    displayName: "Mercaria",
    avatarFileId: "file_mercaria_logo",
    description: "Marketplace",
  });

  const display = await resolveMerchantDisplay(merchant);

  expect(display).toEqual({
    name: "Mercaria",
    // The public-CDN builder (`oxyClient.getFileDownloadUrl`) — never a
    // hand-built `cloud.oxy.so` string — with the ecosystem's 'thumb' variant.
    avatarUrl: "https://cloud.oxy.so/file_mercaria_logo?variant=thumb",
    description: "Marketplace",
  });
});

test("falls back to a neutral name and null avatar/description when unset", async () => {
  const merchant = await Merchant.create({
    publicId: "merch_test_display_2",
    oxyAppId: "app_display_2",
    environment: "development",
    network: "testnet",
    xpub: XPUB,
  });

  const display = await resolveMerchantDisplay(merchant);

  expect(display.name).toBe("Oxy Pay merchant");
  expect(display.avatarUrl).toBeNull();
  expect(display.description).toBeNull();
});

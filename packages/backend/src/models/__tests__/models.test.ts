import { test, expect, beforeAll, afterAll } from "bun:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { TESTNET, MAINNET, mnemonicToSeed, deriveKeyFromSeed } from "@fairco.in/core";
import { Merchant } from "../Merchant";
import { PaymentIntent } from "../PaymentIntent";
import { WebhookDelivery } from "../WebhookDelivery";
import { reserveNextAddress } from "../../services/reserveAddress";
import { toBaseUnits, fromBaseUnits } from "../../lib/money";

// Real TESTNET account xpub for the canonical all-"abandon" + "art" mnemonic
// (m/44'/1'/0' neutered) — public-key-only, cannot spend.
const XPUB =
  "DRKVrRr8WgU4mARJnCLAp77sKJ5h5K79VH8sredx2qPY8BUKogTYqoAXdTAzzvS5MgBDGGWb2Zoa2AwzoLRsbGGkBm1q2r7QSfRYWCizWfvMfPZn";

// The same 24-word mnemonic the xpub was derived from, used here to build the
// matching PRIVATE xprv that the non-custody firewall must reject.
const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";

// The same mnemonic's MAINNET-network account xpub (distinct BIP32 version
// bytes from XPUB above) — the non-custody derivation firewall in Merchant's
// pre-validate hook enforces that `xpub`'s encoded network matches `network`,
// so a "production environment on mainnet" fixture needs a real mainnet xpub.
const MAINNET_XPUB = deriveKeyFromSeed(mnemonicToSeed(MNEMONIC), MAINNET)
  .derive(`m/44'/${MAINNET.bip44CoinType}'/0'`)
  .hdKey.publicExtendedKey;

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  // Build declared indexes (incl. the compound unique idempotency index) so the
  // replay-collision assertion is deterministic rather than racing index build.
  await Merchant.init();
  await PaymentIntent.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

test("saves a Merchant with a watch-only testnet xpub", async () => {
  const merchant = await Merchant.create({
    publicId: "merch_test0000000000000001",
    oxyAppId: "app_watch_only_ok",
    environment: "development",
    network: "testnet",
    xpub: XPUB,
    webhookUrl: "https://example.test/webhook",
    webhookSecret: "whsec_test",
  });

  expect(merchant.oxyAppId).toBe("app_watch_only_ok");
  expect(merchant.network).toBe("testnet");
  expect(merchant.nextDerivationIndex).toBe(0);
  expect(merchant.requiredConfirmations).toBe(1);
  expect(merchant.livemode).toBe(false);
});

test("saves a Merchant with optional display identity fields", async () => {
  const merchant = await Merchant.create({
    publicId: "merch_test0000000000000008",
    oxyAppId: "app_with_identity",
    environment: "development",
    network: "testnet",
    xpub: XPUB,
    displayName: "Mercaria",
    avatarFileId: "file_mercaria_logo",
    description: "Marketplace",
  });

  expect(merchant.displayName).toBe("Mercaria");
  expect(merchant.avatarFileId).toBe("file_mercaria_logo");
  expect(merchant.description).toBe("Marketplace");
});

test("display identity fields are optional (existing merchants unaffected)", async () => {
  const merchant = await Merchant.create({
    publicId: "merch_test0000000000000009",
    oxyAppId: "app_no_identity",
    environment: "development",
    network: "testnet",
    xpub: XPUB,
  });

  expect(merchant.displayName).toBeUndefined();
  expect(merchant.avatarFileId).toBeUndefined();
  expect(merchant.description).toBeUndefined();
});

test("rejects a Merchant whose xpub is a private xprv (non-custody firewall)", async () => {
  const seed = mnemonicToSeed(MNEMONIC);
  const root = deriveKeyFromSeed(seed, TESTNET);
  const accountNode = root.derive(`m/44'/${TESTNET.bip44CoinType}'/0'`);
  const xprv = accountNode.hdKey.privateExtendedKey;

  const attempt = Merchant.create({
    publicId: "merch_test0000000000000002",
    oxyAppId: "app_private_xprv_rejected",
    environment: "development",
    network: "testnet",
    xpub: xprv,
  });

  await expect(attempt).rejects.toThrow("watch-only violation");
});

test("the Merchant schema exposes no private-key / mnemonic / seed field", () => {
  const paths = Object.keys(Merchant.schema.paths);
  for (const forbidden of ["privateKey", "mnemonic", "seed", "xprv"]) {
    expect(paths).not.toContain(forbidden);
  }
});

test("reserveNextAddress claims monotonically increasing indexes with distinct addresses", async () => {
  const merchant = await Merchant.create({
    publicId: "merch_test0000000000000003",
    oxyAppId: "app_reserve_addresses",
    environment: "development",
    network: "testnet",
    xpub: XPUB,
  });

  const first = await reserveNextAddress(merchant.id);
  const second = await reserveNextAddress(merchant.id);
  const third = await reserveNextAddress(merchant.id);

  expect(first).toEqual({ index: 0, address: "TC8KNvRhFUJUepcCSjBBeLa5HYo4Na11w3" });
  expect(second).toEqual({ index: 1, address: "TVdQEadb9Yurh3QCBf1vwjZxNySQvHxFmk" });
  expect(third).toEqual({ index: 2, address: "TRhbVij2oTwETnzpVNDixacseS48FZgsUZ" });

  const addresses = new Set([first.address, second.address, third.address]);
  expect(addresses.size).toBe(3);

  const reloaded = await Merchant.findById(merchant.id);
  expect(reloaded?.nextDerivationIndex).toBe(3);
});

test("PaymentIntent persists the DTO shape with a compound idempotency index", async () => {
  const now = new Date();
  const created = await PaymentIntent.create({
    id: "pi_0000000000000000000000aa",
    status: "created",
    amount: "150000000",
    network: "testnet",
    address: "TC8KNvRhFUJUepcCSjBBeLa5HYo4Na11w3",
    merchantId: "merchant_abc",
    clientSecret: "pi_0000000000000000000000aa_secret_x",
    idempotencyKey: "idem_key_1",
    metadata: new Map([["orderId", "order_1"]]),
    expiresAt: new Date(now.getTime() + 60_000),
  });

  expect(created.object).toBe("payment_intent");
  expect(created.currency).toBe("FAIR");
  expect(created.txid).toBeNull();
  expect(created.confirmations).toBe(0);
  expect(created.metadata.get("orderId")).toBe("order_1");

  // The compound (merchantId, idempotencyKey) index is unique: a replay collides.
  const replay = PaymentIntent.create({
    id: "pi_0000000000000000000000bb",
    status: "created",
    amount: "150000000",
    network: "testnet",
    address: "TVdQEadb9Yurh3QCBf1vwjZxNySQvHxFmk",
    merchantId: "merchant_abc",
    clientSecret: "pi_0000000000000000000000bb_secret_y",
    idempotencyKey: "idem_key_1",
    expiresAt: new Date(now.getTime() + 60_000),
  });

  await expect(replay).rejects.toThrow();
});

test("PaymentIntent declares supporting indexes on merchantId and address", async () => {
  const indexes = await PaymentIntent.collection.indexes();
  const leadingKeys = indexes.map((index) => Object.keys(index.key)[0]);

  // GET /v1/payment_intents filters + cursor-paginates by merchantId.
  expect(leadingKeys).toContain("merchantId");
  // services/enrichment.ts looks up PaymentIntent.find({ address: {$in} }).
  expect(leadingKeys).toContain("address");
});

test("toBaseUnits / fromBaseUnits round-trip canonical integer strings", () => {
  expect(toBaseUnits("150000000")).toBe(150_000_000n);
  expect(fromBaseUnits(150_000_000n)).toBe("150000000");
  expect(fromBaseUnits(toBaseUnits("42"))).toBe("42");
  expect(toBaseUnits("0")).toBe(0n);
});

test("toBaseUnits rejects a fractional amount", () => {
  expect(() => toBaseUnits("1.5")).toThrow();
});

test("fromBaseUnits rejects a negative amount", () => {
  expect(() => fromBaseUnits(-1n)).toThrow();
});

test("two Merchant docs with the same oxyAppId but different environment coexist", async () => {
  await Merchant.create({
    publicId: "merch_test0000000000000004",
    oxyAppId: "app_env_split",
    environment: "development",
    network: "testnet",
    xpub: XPUB,
  });
  const prod = await Merchant.create({
    publicId: "merch_test0000000000000005",
    oxyAppId: "app_env_split",
    environment: "production",
    network: "mainnet",
    xpub: MAINNET_XPUB,
  });
  expect(prod.environment).toBe("production");

  const count = await Merchant.countDocuments({ oxyAppId: "app_env_split" });
  expect(count).toBe(2);
});

test("the SAME oxyAppId + environment pair collides (compound unique index)", async () => {
  await Merchant.create({
    publicId: "merch_test0000000000000006",
    oxyAppId: "app_env_dup",
    environment: "development",
    network: "testnet",
    xpub: XPUB,
  });
  const dup = Merchant.create({
    publicId: "merch_test0000000000000007",
    oxyAppId: "app_env_dup",
    environment: "development",
    network: "testnet",
    xpub: XPUB,
  });
  await expect(dup).rejects.toThrow();
});

test("WebhookDelivery persists one row per delivery attempt, keyed by merchantId", async () => {
  const delivery = await WebhookDelivery.create({
    merchantId: "merchant_xyz",
    intentId: "pi_0000000000000000000000e1",
    eventId: "evt_0000000000000000000000e1",
    eventType: "payment_intent.settled",
    url: "https://merchant.example/hook",
    attempts: 1,
    delivered: true,
    lastStatus: "delivered",
  });

  expect(delivery.merchantId).toBe("merchant_xyz");
  expect(delivery.delivered).toBe(true);
  expect(delivery.lastStatus).toBe("delivered");

  const count = await WebhookDelivery.countDocuments({ merchantId: "merchant_xyz" });
  expect(count).toBe(1);
});

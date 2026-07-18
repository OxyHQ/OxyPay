import { test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Merchant } from "../../models/Merchant";
import { PaymentIntent } from "../../models/PaymentIntent";
import type { ExplorerTx } from "../explorer";
import {
  SettlementWatcher,
  type WatcherDeps,
  type HydratedPaymentIntentDoc,
} from "../settlementWatcher";

// Real TESTNET account xpub for the canonical all-"abandon" + "art" mnemonic
// (m/44'/1'/0' neutered) — public-key-only, cannot spend. Its index-0 external
// address is TC8KNvRhFUJUepcCSjBBeLa5HYo4Na11w3.
const XPUB =
  "DRKVrRr8WgU4mARJnCLAp77sKJ5h5K79VH8sredx2qPY8BUKogTYqoAXdTAzzvS5MgBDGGWb2Zoa2AwzoLRsbGGkBm1q2r7QSfRYWCizWfvMfPZn";
const ADDRESS = "TC8KNvRhFUJUepcCSjBBeLa5HYo4Na11w3";
const AMOUNT = "100000000";
const PAID_VALUE = 100_000_000n;
const REQUIRED_CONFIRMATIONS = 2;

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Merchant.init();
  await PaymentIntent.init();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

afterEach(async () => {
  await PaymentIntent.deleteMany({});
  await Merchant.deleteMany({});
});

test("advances a paid intent broadcast → confirming → settled as confirmations climb", async () => {
  const merchant = await Merchant.create({
    oxyAppId: "app_settle",
    environment: "development",
    network: "testnet",
    xpub: XPUB,
    requiredConfirmations: REQUIRED_CONFIRMATIONS,
  });

  const now = new Date();
  const intent = await PaymentIntent.create({
    id: "pi_0000000000000000000000c1",
    status: "broadcast",
    amount: AMOUNT,
    network: "testnet",
    address: ADDRESS,
    merchantId: merchant.id,
    txid: "tx_settle",
    clientSecret: "pi_0000000000000000000000c1_secret_x",
    idempotencyKey: "idem_settle",
    expiresAt: new Date(now.getTime() + 60_000),
  });

  // Stub the Explorer: same output paying the intent address in full, with the
  // confirmation count climbing 0 → 1 → 2 across successive check() calls.
  let observedConfirmations = 0;
  const getTransaction: WatcherDeps["getTransaction"] = async (txid) => {
    if (txid !== "tx_settle") return null;
    const confirmations = observedConfirmations;
    if (observedConfirmations < REQUIRED_CONFIRMATIONS) {
      observedConfirmations += 1;
    }
    return {
      txid,
      confirmations,
      outputs: [{ address: ADDRESS, valueSat: PAID_VALUE }],
    } satisfies ExplorerTx;
  };

  const changes: string[] = [];
  const onChange: WatcherDeps["onChange"] = (updated: HydratedPaymentIntentDoc) => {
    changes.push(updated.status);
  };

  const watcher = new SettlementWatcher({ getTransaction, onChange });

  await watcher.check();
  expect((await PaymentIntent.findById(intent._id))?.status).toBe("confirming");

  await watcher.check();
  expect((await PaymentIntent.findById(intent._id))?.status).toBe("confirming");

  await watcher.check();
  const settled = await PaymentIntent.findById(intent._id);
  expect(settled?.status).toBe("settled");
  expect(settled?.confirmations).toBe(REQUIRED_CONFIRMATIONS);

  // onChange fires ONCE per actual status change: broadcast→confirming, then
  // confirming→settled. The middle poll (confirming→confirming) does not fire.
  expect(changes).toEqual(["confirming", "settled"]);
});

test("marks an under-value payment as failed", async () => {
  const merchant = await Merchant.create({
    oxyAppId: "app_under",
    environment: "development",
    network: "testnet",
    xpub: XPUB,
    requiredConfirmations: REQUIRED_CONFIRMATIONS,
  });

  const now = new Date();
  const intent = await PaymentIntent.create({
    id: "pi_0000000000000000000000c2",
    status: "broadcast",
    amount: AMOUNT,
    network: "testnet",
    address: ADDRESS,
    merchantId: merchant.id,
    txid: "tx_under",
    clientSecret: "pi_0000000000000000000000c2_secret_y",
    idempotencyKey: "idem_under",
    expiresAt: new Date(now.getTime() + 60_000),
  });

  // A tx is present for this intent but pays less than the intent amount.
  const getTransaction: WatcherDeps["getTransaction"] = async (txid) => {
    if (txid !== "tx_under") return null;
    return {
      txid,
      confirmations: 1,
      outputs: [{ address: ADDRESS, valueSat: 50_000_000n }],
    } satisfies ExplorerTx;
  };

  const changes: string[] = [];
  const onChange: WatcherDeps["onChange"] = (updated: HydratedPaymentIntentDoc) => {
    changes.push(updated.status);
  };

  const watcher = new SettlementWatcher({ getTransaction, onChange });
  await watcher.check();

  expect((await PaymentIntent.findById(intent._id))?.status).toBe("failed");
  expect(changes).toEqual(["failed"]);
});

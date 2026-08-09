import { test, expect } from "bun:test";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import type { Server as SocketServer } from "socket.io";
import {
  updateIntentState,
  type PaymentIntentRow,
} from "../db/payments/paymentIntentRepository";
import { listDeliveriesForMerchant } from "../db/webhooks/webhookDeliveryRepository";
import {
  gatewayDb,
  seedIntent,
  seedMerchant,
  useGatewayDatabase,
} from "./helpers/gatewayTestDatabase";
import { onIntentChange } from "../server";
import type { SafeFetchFn } from "../services/webhookDispatcher";

const XPUB =
  "DRKVrRr8WgU4mARJnCLAp77sKJ5h5K79VH8sredx2qPY8BUKogTYqoAXdTAzzvS5MgBDGGWb2Zoa2AwzoLRsbGGkBm1q2r7QSfRYWCizWfvMfPZn";
const ADDRESS = "TC8KNvRhFUJUepcCSjBBeLa5HYo4Na11w3";

useGatewayDatabase();

function fakeIo(): SocketServer {
  return { to: () => ({ emit: () => {} }) } as unknown as SocketServer;
}

function fakeSafeFetchOk(): SafeFetchFn {
  return (async () => {
    const response = new IncomingMessage(new Socket());
    return { response, status: 200, headers: {}, finalUrl: "https://merchant.example/hook" };
  }) as SafeFetchFn;
}

test("onIntentChange persists a WebhookDelivery after a successful delivery", async () => {
  const merchant = await seedMerchant({
    publicId: "merch_test_delivery_log_1",
    oxyAppId: "app_delivery_log",
    environment: "development",
    network: "testnet",
    xpub: XPUB,
    webhookUrl: "https://merchant.example/hook",
    webhookSecret: "whsec_log",
  });
  const seeded = await seedIntent(merchant, {
    publicId: "pi_0000000000000000000000d1",
    amount: "100000000",
    network: "testnet",
    address: ADDRESS,
    clientSecret: "pi_0000000000000000000000d1_secret_x",
    idempotencyKey: "idem_delivery_log",
    expiresAt: new Date(Date.now() + 60_000),
  });
  // `status`/`txid` are not seed parameters — an intent is MINTED `created` —
  // and `WEBHOOK_EVENT_FOR` only emits for a terminal status, so the fixture
  // moves it through the writer production uses. `updateIntentState` sets both
  // in ONE statement, which is what
  // `payment_intents_broadcast_requires_txid_check` requires for `settled`,
  // and it returns the row `onChange` receives in production.
  const intent = await updateIntentState(gatewayDb(), seeded.id, {
    status: "settled",
    txid: "tx_delivery_log",
    confirmations: 1,
  });
  if (!intent) throw new Error("intent fixture missing");

  await onIntentChange(fakeIo(), intent, fakeSafeFetchOk());

  const deliveries = (
    await listDeliveriesForMerchant(gatewayDb(), { merchantId: merchant.id, limit: 50 })
  ).data;
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]?.paymentIntentId).toBe(intent.id);
  expect(deliveries[0]?.eventType).toBe("payment_intent.settled");
  expect(deliveries[0]?.delivered).toBe(true);
  expect(deliveries[0]?.attempts).toBe(1);
  expect(deliveries[0]?.lastStatus).toBe("delivered");
});

test("onIntentChange does not throw when persisting the delivery log fails (best-effort, matches deliver()'s own contract)", async () => {
  const merchant = await seedMerchant({
    publicId: "merch_test_delivery_log_2",
    oxyAppId: "app_delivery_log_fail",
    environment: "development",
    network: "testnet",
    xpub: XPUB,
    webhookUrl: "https://merchant.example/hook",
    webhookSecret: "whsec_log_fail",
  });
  const seeded = await seedIntent(merchant, {
    publicId: "pi_0000000000000000000000d2",
    amount: "100000000",
    network: "testnet",
    address: "TVdQEadb9Yurh3QCBf1vwjZxNySQvHxFmk",
    clientSecret: "pi_0000000000000000000000d2_secret_y",
    idempotencyKey: "idem_delivery_log_fail",
    expiresAt: new Date(Date.now() + 60_000),
  });
  const settled = await updateIntentState(gatewayDb(), seeded.id, {
    status: "settled",
    txid: "tx_delivery_log_fail",
    confirmations: 1,
  });
  if (!settled) throw new Error("intent fixture missing");

  /**
   * The delivery-log write is made to fail FOR REAL rather than by mocking the
   * writer: `webhook_deliveries.payment_intent_id` references
   * `payment_intents.id`, so an intent id that is not in the table is refused
   * by the database, inside `insertWebhookDelivery`, exactly where
   * `spyOn(WebhookDelivery, "create").mockRejectedValue(...)` used to make it
   * fail. There is no counterpart to that spy here — `server.ts` imports
   * `insertWebhookDelivery` directly, so a spy on the module namespace would
   * not intercept the binding it holds, and `mock.module` replaces the module
   * process-wide for every other file in the run.
   *
   * Everything before the write still runs against real state: the merchant is
   * registered with a webhook URL and secret, so `findWebhookTarget` resolves,
   * and `deliver()` succeeds against `fakeSafeFetchOk`.
   */
  const intent: PaymentIntentRow = {
    ...settled,
    id: "0199ffff-ffff-7fff-8fff-ffffffffffff",
  };

  await expect(onIntentChange(fakeIo(), intent, fakeSafeFetchOk())).resolves.toBeUndefined();
});

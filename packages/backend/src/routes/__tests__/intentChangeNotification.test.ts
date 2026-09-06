import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import type { RequestHandler } from "express";
import type { OxyAuthRequest } from "@oxyhq/core/server";
import type { PaymentIntentRow } from "../../db/payments/paymentIntentRepository";
import { findIntentByPublicId } from "../../db/payments/paymentIntentRepository";
import {
  gatewayDb,
  seedIntent,
  seedMerchant,
  useGatewayDatabase,
} from "../../__tests__/helpers/gatewayTestDatabase";
import { createPaymentIntentsRouter } from "../paymentIntents";
import type { MerchantRow } from "../../db/merchants/merchantRepository";

// Same testnet account xpub the other route suites use — public-key-only.
const XPUB =
  "DRKVrRr8WgU4mARJnCLAp77sKJ5h5K79VH8sredx2qPY8BUKogTYqoAXdTAzzvS5MgBDGGWb2Zoa2AwzoLRsbGGkBm1q2r7QSfRYWCizWfvMfPZn";
const TEST_APP_ID = "app_notify";
const TXID = "c".repeat(64);

const stubRequireMerchant: RequestHandler = (req, _res, next) => {
  (req as OxyAuthRequest).serviceApp = {
    appId: TEST_APP_ID,
    appName: "t",
    scopes: ["payments:read", "payments:write"],
    credentialId: "c",
    environment: "development",
  };
  next();
};

// The router registers a dual-auth GET route that needs this middleware even
// though no test here exercises it.
const stubOptionalServiceAuth: RequestHandler = (_req, _res, next) => {
  next();
};

useGatewayDatabase();

let server: Server;
let baseUrl: string;
let merchant: MerchantRow;

/** Rows handed to the injected notifier, in call order. */
let notified: PaymentIntentRow[];
/** When set, the notifier throws it — proving a broken fanout cannot fail the route. */
let notifyError: Error | null;

beforeAll(async () => {
  merchant = await seedMerchant({
    publicId: "merch_notify000000000000001",
    oxyAppId: TEST_APP_ID,
    environment: "development",
    network: "testnet",
    xpub: XPUB,
  });

  const app = express();
  app.use(express.json());
  app.use(
    createPaymentIntentsRouter({
      requireMerchant: stubRequireMerchant,
      optionalServiceAuth: stubOptionalServiceAuth,
      notifyIntentChange: async (intent) => {
        notified.push(intent);
        if (notifyError) throw notifyError;
      },
    }),
  );

  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function reset(): void {
  notified = [];
  notifyError = null;
}

describe("submit_tx fans the change out", () => {
  test("notifies with the broadcast row, txid included", async () => {
    reset();
    const intent = await seedIntent(merchant, { clientSecret: "pi_notify_secret_1" });

    const res = await fetch(`${baseUrl}/v1/payment_intents/${intent.publicId}/submit_tx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_secret: "pi_notify_secret_1", txid: TXID }),
    });

    expect(res.status).toBe(200);
    // The payer's checkout page learns the payment landed ONLY through this
    // fanout; before it was wired the page sat on its initial REST snapshot.
    expect(notified).toHaveLength(1);
    expect(notified[0]?.status).toBe("broadcast");
    expect(notified[0]?.txid).toBe(TXID);
    expect(notified[0]?.publicId).toBe(intent.publicId);
  });

  test("a throwing notifier still returns 200 and leaves the intent broadcast", async () => {
    reset();
    notifyError = new Error("socket is down");
    const intent = await seedIntent(merchant, { clientSecret: "pi_notify_secret_2" });

    const res = await fetch(`${baseUrl}/v1/payment_intents/${intent.publicId}/submit_tx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_secret: "pi_notify_secret_2", txid: TXID }),
    });

    // The state transition already committed. Reporting it as a 500 would tell
    // a payer their broadcast failed when the gateway has in fact recorded it.
    expect(res.status).toBe(200);
    const reloaded = await findIntentByPublicId(gatewayDb(), intent.publicId);
    expect(reloaded?.status).toBe("broadcast");
  });

  test("a rejected transition notifies nobody", async () => {
    reset();
    const intent = await seedIntent(merchant, { clientSecret: "pi_notify_secret_3" });
    const body = JSON.stringify({ client_secret: "pi_notify_secret_3", txid: TXID });
    const url = `${baseUrl}/v1/payment_intents/${intent.publicId}/submit_tx`;
    const headers = { "Content-Type": "application/json" };

    await fetch(url, { method: "POST", headers, body });
    expect(notified).toHaveLength(1);

    // Second call: `broadcast → broadcast` is idempotent in `applyEvent`, but a
    // wrong secret is refused before any state is touched, so nothing fans out.
    const refused = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ client_secret: "pi_wrong", txid: TXID }),
    });
    expect(refused.status).toBe(403);
    expect(notified).toHaveLength(1);
  });
});

describe("reject fans the change out", () => {
  test("notifies with the rejected row", async () => {
    reset();
    const intent = await seedIntent(merchant, { clientSecret: "pi_notify_secret_4" });

    const res = await fetch(`${baseUrl}/v1/payment_intents/${intent.publicId}/reject`, {
      method: "POST",
    });

    expect(res.status).toBe(200);
    // `payment_intent.rejected` is a registered webhook event type whose only
    // writer is this route, so before this fanout existed it could never fire.
    expect(notified).toHaveLength(1);
    expect(notified[0]?.status).toBe("rejected");
    expect(notified[0]?.publicId).toBe(intent.publicId);
  });

  test("an illegal transition returns 409 and notifies nobody", async () => {
    reset();
    const intent = await seedIntent(merchant, { clientSecret: "pi_notify_secret_5" });

    // Move it to `broadcast` first. `ALLOWED.broadcast` is
    // `['confirming', 'failed']`, so rejecting a broadcast intent is refused —
    // unlike re-rejecting a rejected one, which `applyEvent` treats as an
    // idempotent no-op rather than an error.
    await fetch(`${baseUrl}/v1/payment_intents/${intent.publicId}/submit_tx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_secret: "pi_notify_secret_5", txid: TXID }),
    });
    expect(notified).toHaveLength(1);

    const refused = await fetch(`${baseUrl}/v1/payment_intents/${intent.publicId}/reject`, {
      method: "POST",
    });
    expect(refused.status).toBe(409);
    // Nothing was written, so nothing may be announced.
    expect(notified).toHaveLength(1);
  });
});

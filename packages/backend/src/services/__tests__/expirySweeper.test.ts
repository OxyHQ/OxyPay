import { test, expect, describe } from "bun:test";
import { PAYMENT_INTENT_STATUSES } from "@peable.to/shared-types";
import type { PaymentIntentStatus } from "@peable.to/shared-types";
import {
  EXPIRABLE_STATUSES,
  expireDueIntents,
  findIntentByPublicId,
  updateIntentState,
} from "../../db/payments/paymentIntentRepository";
import type { PaymentIntentRow } from "../../db/payments/paymentIntentRepository";
import {
  gatewayDb,
  seedIntent,
  seedMerchant,
  useGatewayDatabase,
} from "../../__tests__/helpers/gatewayTestDatabase";
import { applyEvent } from "../intentState";
import { ExpirySweeper } from "../expirySweeper";
import type { MerchantRow } from "../../db/merchants/merchantRepository";

const XPUB =
  "DRKVrRr8WgU4mARJnCLAp77sKJ5h5K79VH8sredx2qPY8BUKogTYqoAXdTAzzvS5MgBDGGWb2Zoa2AwzoLRsbGGkBm1q2r7QSfRYWCizWfvMfPZn";
const PAST = new Date(Date.now() - 60_000);
const FUTURE = new Date(Date.now() + 60 * 60_000);

useGatewayDatabase();

async function merchant(publicId: string, oxyAppId: string): Promise<MerchantRow> {
  return seedMerchant({
    publicId,
    oxyAppId,
    environment: "development",
    network: "testnet",
    xpub: XPUB,
  });
}

describe("EXPIRABLE_STATUSES agrees with the transition table", () => {
  // The constant is a hand-written list used by a set-based UPDATE, so it
  // cannot call `applyEvent` per row. This re-derives it from `applyEvent`
  // instead: if shared-types' ALLOWED table ever gains or loses an `expired`
  // edge, the constant goes red here rather than silently sweeping the wrong
  // rows — or, worse, expiring an intent with money in flight.
  //
  // `expired` itself is excluded, and that exclusion is load-bearing:
  // `applyEvent` is idempotent when current === target, so it returns
  // `"expired"` rather than throwing for an already-expired intent. A set-based
  // sweeper that trusted `applyEvent` alone would re-claim those rows on every
  // tick and re-fire `payment_intent.expired` forever.
  const derived = (PAYMENT_INTENT_STATUSES as PaymentIntentStatus[]).filter(
    (status) => {
      if (status === "expired") return false;
      try {
        return applyEvent(status, "expire") === "expired";
      } catch {
        return false;
      }
    },
  );

  test("the constant is exactly the set of statuses that may expire", () => {
    expect([...EXPIRABLE_STATUSES].sort()).toEqual([...derived].sort());
  });

  test("in-flight statuses are never expirable", () => {
    expect(EXPIRABLE_STATUSES).not.toContain("broadcast");
    expect(EXPIRABLE_STATUSES).not.toContain("confirming");
  });
});

describe("expireDueIntents", () => {
  test("expires a due intent and leaves a not-yet-due one alone", async () => {
    const m = await merchant("merch_expiry00000000000001", "app_expiry_1");
    const due = await seedIntent(m, { expiresAt: PAST });
    const notDue = await seedIntent(m, { expiresAt: FUTURE });

    const claimed = await expireDueIntents(gatewayDb(), new Date());

    expect(claimed.map((row) => row.publicId)).toEqual([due.publicId]);
    expect((await findIntentByPublicId(gatewayDb(), due.publicId))?.status).toBe("expired");
    expect((await findIntentByPublicId(gatewayDb(), notDue.publicId))?.status).toBe("created");
  });

  test("never expires an intent with money in flight, however overdue", async () => {
    const m = await merchant("merch_expiry00000000000002", "app_expiry_2");
    const inFlight = await seedIntent(m, { expiresAt: PAST });
    // `payment_intents_broadcast_requires_txid_check` needs both in one write.
    await updateIntentState(gatewayDb(), inFlight.id, {
      status: "broadcast",
      txid: "d".repeat(64),
    });

    const claimed = await expireDueIntents(gatewayDb(), new Date());

    expect(claimed).toHaveLength(0);
    expect((await findIntentByPublicId(gatewayDb(), inFlight.publicId))?.status).toBe(
      "broadcast",
    );
  });

  test("two concurrent sweepers never claim the same intent twice", async () => {
    const m = await merchant("merch_expiry00000000000003", "app_expiry_3");
    const overdue = await Promise.all(
      Array.from({ length: 8 }, () => seedIntent(m, { expiresAt: PAST })),
    );
    const now = new Date();

    // The real failure this guards: two ECS tasks sweep on their own timers. A
    // SELECT-then-UPDATE would hand both the same rows and fire the merchant's
    // `payment_intent.expired` webhook twice for one intent.
    const [a, b] = await Promise.all([
      expireDueIntents(gatewayDb(), now),
      expireDueIntents(gatewayDb(), now),
    ]);

    const claimedIds = [...a, ...b].map((row) => row.publicId);
    expect(claimedIds).toHaveLength(overdue.length);
    expect(new Set(claimedIds).size).toBe(overdue.length);
  });
});

describe("ExpirySweeper", () => {
  test("announces every intent it claimed, and nothing else", async () => {
    const m = await merchant("merch_expiry00000000000004", "app_expiry_4");
    const due = await seedIntent(m, { expiresAt: PAST });
    await seedIntent(m, { expiresAt: FUTURE });

    const announced: PaymentIntentRow[] = [];
    const sweeper = new ExpirySweeper({ onChange: (intent) => { announced.push(intent); } });
    await sweeper.check();

    expect(announced).toHaveLength(1);
    expect(announced[0]?.publicId).toBe(due.publicId);
    // The row handed over carries the state the database stored, not the
    // pre-update one — this is what makes `payment_intent.expired` correct.
    expect(announced[0]?.status).toBe("expired");
  });

  test("a second sweep announces nothing, since the rows are already terminal", async () => {
    const m = await merchant("merch_expiry00000000000005", "app_expiry_5");
    await seedIntent(m, { expiresAt: PAST });

    const announced: PaymentIntentRow[] = [];
    const sweeper = new ExpirySweeper({ onChange: (intent) => { announced.push(intent); } });
    await sweeper.check();
    await sweeper.check();

    expect(announced).toHaveLength(1);
  });

  test("the injected clock decides what is due", async () => {
    const m = await merchant("merch_expiry00000000000006", "app_expiry_6");
    const later = await seedIntent(m, { expiresAt: FUTURE });

    // Asserted by membership, not by an exact list: every test in this file
    // shares one database, so a clock far enough forward also sweeps the
    // not-yet-due intents the earlier cases left behind. The property under
    // test is that THIS intent's fate follows the clock.
    const claimedAt = async (now: Date): Promise<string[]> => {
      const announced: PaymentIntentRow[] = [];
      await new ExpirySweeper({
        onChange: (intent) => { announced.push(intent); },
        now: () => now,
      }).check();
      return announced.map((row) => row.publicId);
    };

    expect(await claimedAt(new Date())).not.toContain(later.publicId);
    expect(await claimedAt(new Date(FUTURE.getTime() + 1_000))).toContain(later.publicId);
  });
});

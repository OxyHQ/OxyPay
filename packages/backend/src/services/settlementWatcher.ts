import type { HydratedDocument } from "mongoose";
import type { PaymentIntentStatus } from "@oxypay/shared-types";
import { PaymentIntent } from "../models/PaymentIntent";
import type { PaymentIntentDoc } from "../models/PaymentIntent";
import { Merchant } from "../models/Merchant";
import { toBaseUnits } from "../lib/money";
import { applyEvent } from "./intentState";
import { verifyPayment } from "./explorer";

/**
 * How often the fallback poller re-checks the chain for in-flight intents. The
 * Explorer tip WebSocket can drive `check()` directly later; for F1 a periodic
 * poll is sufficient. The timer is `.unref()`-ed so it never keeps the event
 * loop (or a test run) alive.
 */
const POLL_INTERVAL_MS = 5_000;

/**
 * Intents that require settlement tracking sit in exactly these two states with
 * a payer-reported `txid`. Terminal/pre-broadcast intents are never polled.
 */
const WATCHABLE_STATUSES: readonly PaymentIntentStatus[] = ["broadcast", "confirming"];

/** A hydrated `PaymentIntent` Mongoose document (the persisted intent). */
export type HydratedPaymentIntentDoc = HydratedDocument<PaymentIntentDoc>;

export interface WatcherDeps {
  getTransaction: typeof import("./explorer").getTransaction;
  /** Invoked once per actual status change; the transport (socket/webhook). */
  onChange: (intent: HydratedPaymentIntentDoc) => void | Promise<void>;
}

/**
 * Compute the status a watchable intent should advance to for the observed
 * on-chain fact, chaining pure `applyEvent` transitions:
 *
 *  - the tx is present but does not satisfy the amount  → `underpaid` → `failed`
 *  - paid, confirmations below the threshold            → `mempool_seen` → `confirming`
 *  - paid, confirmations at/above the threshold         → …→ `confirmed` → `settled`
 *
 * `applyEvent` is idempotent on a re-poll (e.g. `mempool_seen` while already
 * `confirming`), so a state that has not moved returns unchanged.
 */
function nextStatusFor(
  current: "broadcast" | "confirming",
  paid: boolean,
  confirmations: number,
  requiredConfirmations: number,
): PaymentIntentStatus {
  if (!paid) {
    return applyEvent(current, "underpaid");
  }

  const confirming =
    current === "broadcast" ? applyEvent(current, "mempool_seen") : current;

  if (confirmations < requiredConfirmations) {
    return confirming;
  }

  return applyEvent(confirming, "confirmed");
}

/**
 * Tip-driven, non-custodial settlement watcher. It only ever *reads* the chain
 * (via the injected `getTransaction`) and advances the `PaymentIntent` state
 * machine; the payer signs and broadcasts. Transport (Socket.io emit + signed
 * webhook) is injected as `onChange`, keeping the watcher pure of I/O concerns.
 */
export class SettlementWatcher {
  private readonly deps: WatcherDeps;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: WatcherDeps) {
    this.deps = deps;
  }

  /** Reconcile every in-flight intent against its on-chain transaction. */
  async check(): Promise<void> {
    const intents = await PaymentIntent.find({
      status: { $in: WATCHABLE_STATUSES },
      txid: { $ne: null },
    });

    for (const intent of intents) {
      await this.reconcile(intent);
    }
  }

  private async reconcile(intent: HydratedPaymentIntentDoc): Promise<void> {
    const { txid } = intent;
    if (txid === null) return;

    const current = intent.status;
    if (current !== "broadcast" && current !== "confirming") return;

    const tx = await this.deps.getTransaction(txid, intent.network);
    // Not yet visible on-chain — this is the "not the right tx yet" case; skip
    // and re-check next tick. Only a returned tx can move the intent to failed.
    if (tx === null) return;

    const merchant = await Merchant.findById(intent.merchantId);
    const requiredConfirmations = merchant?.requiredConfirmations ?? 1;

    const { paid, confirmations } = verifyPayment(
      tx,
      intent.address,
      toBaseUnits(intent.amount),
    );

    const next = nextStatusFor(current, paid, confirmations, requiredConfirmations);
    if (next === current) return;

    intent.status = next;
    intent.confirmations = confirmations;
    await intent.save();
    await this.deps.onChange(intent);
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      this.check().catch((error: unknown) => {
        // A single failed poll must not crash the process or become an
        // unhandled rejection; surface it and let the next tick retry.
        process.emitWarning(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    }, POLL_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

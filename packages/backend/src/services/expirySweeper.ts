import { getDb } from "../db/postgres";
import { expireDueIntents } from "../db/payments/paymentIntentRepository";
import type { PaymentIntentRow } from "../db/payments/paymentIntentRepository";

/**
 * How often unpaid intents past their `expires_at` are swept.
 *
 * Deliberately slower than `SettlementWatcher`'s 5s: expiry races nothing on
 * chain, and its only consumers are the merchant's webhook and a payer still
 * sitting on the checkout page. The timer is `.unref()`-ed so it never keeps
 * the event loop (or a test run) alive.
 */
const SWEEP_INTERVAL_MS = 30_000;

export interface ExpirySweeperDeps {
  /**
   * Invoked once per intent actually expired, with the row AS PERSISTED by the
   * claiming statement — same contract as `WatcherDeps.onChange`.
   */
  onChange: (intent: PaymentIntentRow) => void | Promise<void>;
  /** Clock, injectable so a test can sweep a deterministic instant. */
  now?: () => Date;
}

/**
 * Drives `payment_intents` past their expiry into the `expired` terminal state.
 *
 * Without this, `expires_at` is written by `createIntent` and read by nothing:
 * the `expired` status, its `ALLOWED` transitions, the
 * `payment_intent.expired` webhook event and the checkout's "Payment
 * unavailable" branch are all unreachable code, and an unpaid intent stays
 * payable forever.
 */
export class ExpirySweeper {
  private readonly deps: ExpirySweeperDeps;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: ExpirySweeperDeps) {
    this.deps = deps;
  }

  /** Claim and announce every intent whose expiry has passed. */
  async check(): Promise<void> {
    const now = this.deps.now ? this.deps.now() : new Date();
    // One statement claims the rows; whatever comes back is owned by THIS
    // sweeper, so a sibling ECS task cannot announce the same intent.
    const expired = await expireDueIntents(getDb(), now);

    for (const intent of expired) {
      await this.deps.onChange(intent);
    }
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      this.check().catch((error: unknown) => {
        // A single failed sweep must not crash the process; the next tick
        // retries, and the claim statement is safe to repeat.
        process.emitWarning(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    }, SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

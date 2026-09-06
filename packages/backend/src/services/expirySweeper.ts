/**
 * The expiry sweeper — what makes `expiresAt` mean something.
 *
 * `expire` has been in `intentState.ts`'s event set and in its unit tests since
 * the first release, and `payment_intent.expired` has been in the published
 * webhook contract just as long. Nothing has ever emitted either: there was no
 * caller. An intent whose `expiresAt` passed simply stayed `created` forever,
 * so a merchant integrating on that event to release an inventory reservation
 * would have held it indefinitely, and a payer's abandoned checkout stayed
 * open. ADR 0001 D7 names this as part of making delivery trustworthy — an
 * event type a merchant can subscribe to and never receive is worse than one
 * that does not exist.
 *
 * Shaped like `SettlementWatcher` next door: an `.unref()`-ed interval, a
 * bounded batch, and one transition per intent through `transitionIntent` so
 * the merchant's event is enqueued in the same commit.
 */
import { getDb } from "../db/postgres";
import { findExpiredIntents } from "../db/payments/paymentIntentRepository";
import { applyEvent } from "./intentState";
import { announceIntentChange, transitionIntent } from "./intentTransition";

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_BATCH_SIZE = 100;

export interface ExpirySweepDeps {
  readonly batchSize?: number;
  /** Injectable clock, so a suite can age an intent without waiting. */
  readonly now?: Date;
}

export interface ExpirySweepResult {
  readonly examined: number;
  readonly expired: number;
}

/**
 * Expire every intent whose time has passed, once.
 *
 * Each transition goes through `applyEvent` rather than writing `'expired'`
 * directly, so the state machine stays the single authority on what is legal —
 * a status this sweeper's query returned but the machine refuses is a
 * disagreement worth surfacing rather than overruling, and it is skipped rather
 * than forced.
 *
 * One intent's failure never aborts the sweep. A batch abandoned halfway
 * because of one row is how a queue stops draining.
 */
export async function runExpirySweep(
  deps: ExpirySweepDeps = {},
): Promise<ExpirySweepResult> {
  const now = deps.now ?? new Date();
  const candidates = await findExpiredIntents(getDb(), {
    now,
    limit: deps.batchSize ?? DEFAULT_BATCH_SIZE,
  });

  let expired = 0;
  for (const intent of candidates) {
    try {
      const next = applyEvent(intent.status, "expire");
      if (next === intent.status) continue;
      const updated = await transitionIntent(intent.id, { status: next });
      if (!updated) continue;
      announceIntentChange(updated);
      expired += 1;
    } catch (error) {
      process.emitWarning(
        `Peable expiry sweep failed for intent ${intent.publicId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return { examined: candidates.length, expired };
}

let timer: ReturnType<typeof setInterval> | null = null;

export interface StartExpirySweeperOptions extends ExpirySweepDeps {
  readonly intervalMs?: number;
}

/** Start the background sweep. Idempotent — a second call is a no-op. */
export function startExpirySweeper(options: StartExpirySweeperOptions = {}): void {
  if (timer !== null) return;
  timer = setInterval(() => {
    void runExpirySweep(options).catch((error: unknown) => {
      process.emitWarning(
        `Peable expiry sweep tick failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  timer.unref?.();
}

export function stopExpirySweeper(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

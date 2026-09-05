import {
  type PaymentIntentStatus,
  isValidStatusTransition,
} from "@peable/shared-types";

/**
 * Events that drive a PaymentIntent through its lifecycle. Each event maps to a
 * single target status; the target is validated against the shared transition
 * table (the one exception is documented below).
 */
export type IntentEvent =
  | "deliver"
  | "approve"
  | "reject"
  | "broadcast"
  | "mempool_seen"
  | "confirmed"
  | "underpaid"
  | "expire"
  | "reorg_below_threshold";

function targetStatusFor(event: IntentEvent): PaymentIntentStatus {
  switch (event) {
    case "deliver":
      return "awaiting_approval";
    case "approve":
      return "approved";
    case "reject":
      return "rejected";
    case "broadcast":
      return "broadcast";
    case "mempool_seen":
      return "confirming";
    case "confirmed":
      return "settled";
    // Both broadcast and confirming can fail on an under-value tx; target is failed.
    case "underpaid":
      return "failed";
    // Both created and awaiting_approval can expire; target is expired.
    case "expire":
      return "expired";
    // Rewind of a settled intent — see the exception branch in applyEvent.
    case "reorg_below_threshold":
      return "confirming";
  }
}

/**
 * Advance an intent's status by applying an event. Fails loud (throws) on any
 * illegal transition — never a silent no-op — so a mis-sequenced caller is
 * caught rather than silently corrupting state.
 */
export function applyEvent(
  current: PaymentIntentStatus,
  event: IntentEvent,
): PaymentIntentStatus {
  const target = targetStatusFor(event);

  // Documented exception: a chain reorg can drop an already-settled intent
  // below the confirmation threshold, rewinding settled -> confirming. This is
  // the ONE transition that bypasses the happy-path table (settled is
  // otherwise terminal), so it is NOT validated via isValidStatusTransition.
  // It is only ever legal from settled.
  if (event === "reorg_below_threshold") {
    if (current !== "settled") {
      throw new Error(
        `invalid event 'reorg_below_threshold' from '${current}': only a settled intent can reorg below threshold`,
      );
    }
    return target;
  }

  // Idempotent re-poll: the settlement watcher may re-observe the same mempool
  // state (e.g. mempool_seen while already confirming). Returning the current
  // status unchanged lets the watcher re-check safely without tripping the
  // fail-loud guard below.
  if (current === target) {
    return current;
  }

  if (!isValidStatusTransition(current, target)) {
    throw new Error(
      `illegal transition: cannot apply '${event}' (${current} -> ${target})`,
    );
  }

  return target;
}

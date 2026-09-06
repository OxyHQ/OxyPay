/**
 * What a stored provider event MEANS.
 *
 * The other half of ADR 0001 D11's split: `ingress.ts` decides whether a
 * delivery is authentic and writes it down; this decides what it does to a
 * payment. They are separate because the provider is waiting on the first and
 * must not be waiting on the second — an event whose handling fails is a row to
 * retry, not a delivery to re-request.
 *
 * **The stored payload is AUTHENTIC but LOSSY, and the difference matters.** It
 * reached this table only through a signature check, so what is in it is what
 * the provider sent — but `redactProviderPayload` is an allow-list, so most of
 * it is gone by design. A handler may read a field the allow-list KEEPS
 * (`amount_reversed` is one, and is why the reversal handler below can work);
 * it must never depend on one the allow-list drops, because that field will be
 * `"[redacted]"` rather than missing, and a numeric read of it silently
 * produces `NaN`. The routing decisions — which object, which handler — are
 * made from `object_ids` and `type`, which the ingress derived at verification
 * time and which redaction never touches.
 */
import type { ProviderEventRow } from "../../db/providers/providerEventRepository";
import {
  markProviderEventFailed,
  markProviderEventProcessed,
} from "../../db/providers/providerEventRepository";
import { findIntentById, findIntentByProviderObject } from "../../db/payments/paymentIntentRepository";
import { findRefundByProviderObject } from "../../db/refunds/refundRepository";
import { applyRefundToIntent } from "../refunds/refundService";
import { findAccountByProviderAccountId } from "../../db/accounts/connectedAccountRepository";
import { applyTransferReversal, findTransferByProviderObject } from "../../db/transfers/transferRepository";
import { refreshConnectedAccount } from "../accounts/connectedAccountService";
import { getDb } from "../../db/postgres";
import { applyEvent, type IntentEvent } from "../intentState";
import { announceIntentChange, transitionIntent } from "../intentTransition";
import { redactProviderMessage } from "./redact";
import type { ProviderId } from "./provider";

/**
 * Which provider event types move a payment, and where to.
 *
 * A CLOSED map, and everything absent from it is handled — see `no_mapping`
 * below. That is the difference between "we have not taught the drain about
 * this event yet" and "this event is broken", and only the second should ever
 * look like a problem.
 *
 * Refunds and disputes are deliberately absent: `charge.refunded` and the
 * dispute lifecycle need a refund record of their own to be meaningful, and
 * inventing a status change without one would report money returned that
 * nothing in this database can account for. They are the next phase, and until
 * then their events are stored, marked handled, and act on nothing.
 */
const INTENT_EVENT_FOR: Readonly<Record<string, IntentEvent>> = {
  "payment_intent.succeeded": "card_settled",
  "payment_intent.payment_failed": "card_failed",
  "payment_intent.canceled": "card_canceled",
  "payment_intent.processing": "card_processing",
  "payment_intent.requires_action": "card_requires_action",
  // Stripe's name for "the payer has to do something" on some API versions.
  // Listed alongside rather than instead of: which one arrives depends on the
  // account's API version, and a gateway that pinned only one would silently
  // stop showing SCA challenges when Stripe changed the name.
  "payment_intent.amount_capturable_updated": "card_processing",
};

/** Which key in `object_ids` names the payment this event is about. */
const PAYMENT_OBJECT_KEY = "payment_intent";
/** ...the connected account. */
const ACCOUNT_OBJECT_KEY = "account";
/** ...the transfer. */
const TRANSFER_OBJECT_KEY = "transfer";

/**
 * Account events that mean "re-read this account".
 *
 * All of them do the same thing, and deliberately: the event says something
 * changed, and the only trustworthy account of WHAT is a fresh read. Parsing
 * the account out of the delivery would also work until the payload is
 * redacted — which it is — and then it would work partially, which is worse.
 */
const ACCOUNT_REFRESH_EVENTS: ReadonlySet<string> = new Set([
  "account.updated",
  "account.application.authorized",
  "account.application.deauthorized",
  "capability.updated",
]);

/**
 * Refund events.
 *
 * These exist for the refund a merchant did NOT make — one issued from the
 * provider's dashboard, or a dispute the network resolved. Without them the
 * payer's money is back and this gateway still calls the payment `settled`,
 * which is the disagreement a merchant reconciles against and cannot explain.
 */
const REFUND_EVENTS: ReadonlySet<string> = new Set([
  "charge.refunded",
  "refund.updated",
  "refund.created",
]);

/** Transfer events that carry a cumulative reversed total. */
const TRANSFER_REVERSAL_EVENTS: ReadonlySet<string> = new Set([
  "transfer.reversed",
  "transfer.updated",
]);

export type ProcessOutcome =
  /** The intent moved. */
  | { readonly kind: "applied"; readonly intentId: string; readonly status: string }
  /** Authentic, understood, and the intent is already there. A provider redelivery. */
  | { readonly kind: "noop"; readonly intentId: string }
  /** An event type this drain does not act on. Handled, not failed. */
  | { readonly kind: "no_mapping" }
  /** The event names an object no intent claims. */
  | { readonly kind: "unmatched" }
  /** Something went wrong. The row keeps its error and stays in the drain's set. */
  | { readonly kind: "failed"; readonly error: string };

/**
 * Interpret one event and apply it.
 *
 * Never throws: the drain processes a batch, and one poisonous row must not
 * stop the rows behind it. A failure is recorded on the row and reported.
 */
export async function processProviderEvent(
  event: ProviderEventRow,
): Promise<ProcessOutcome> {
  const db = getDb();

  try {
    if (ACCOUNT_REFRESH_EVENTS.has(event.type)) {
      return await handleAccountEvent(db, event);
    }
    if (TRANSFER_REVERSAL_EVENTS.has(event.type)) {
      return await handleTransferEvent(db, event);
    }
    if (REFUND_EVENTS.has(event.type)) {
      return await handleRefundEvent(db, event);
    }

    const intentEvent = INTENT_EVENT_FOR[event.type];
    if (!intentEvent) {
      await markProviderEventProcessed(db, event.id);
      return { kind: "no_mapping" };
    }

    const objectId = event.objectIds[PAYMENT_OBJECT_KEY];
    if (!objectId) {
      // Mapped to an intent event but carrying no payment id: the envelope and
      // the map disagree, which is a bug here rather than at the provider.
      await markProviderEventFailed(db, event.id, `no ${PAYMENT_OBJECT_KEY} id on a ${event.type}`);
      return { kind: "failed", error: `no ${PAYMENT_OBJECT_KEY} id on a ${event.type}` };
    }

    const intent = await findIntentByProviderObject(
      db,
      event.provider as ProviderId,
      objectId,
    );
    if (!intent) {
      /**
       * No intent claims this object, and that is NOT marked processed.
       *
       * The overwhelmingly likely cause is the two-step create's own window: the
       * row exists but has not been linked yet, and the provider's event beat
       * our own `linkProviderObject` — a race that resolves itself in
       * milliseconds. Marking it handled would drop a real settlement on the
       * floor. Left unprocessed, the drain simply picks it up again.
       *
       * The other cause — an object this gateway never created — resolves the
       * same way from the drain's point of view: it stays, visibly, for an
       * operator, which is the right outcome for an event about money nobody
       * here can account for.
       */
      return { kind: "unmatched" };
    }

    // Already there. A provider redelivering a `succeeded` for a settled
    // payment is ordinary and must not look like an error — and `applyEvent`
    // throws on an illegal transition, so this check comes first rather than
    // being caught afterwards, where a genuine illegal transition would be
    // swallowed with it.
    const target = applyEvent(intent.status, intentEvent);
    if (target === intent.status) {
      await markProviderEventProcessed(db, event.id);
      return { kind: "noop", intentId: intent.id };
    }

    const updated = await transitionIntent(intent.id, { status: target });
    if (!updated) {
      // The row moved between the read and the update. Not marked processed:
      // the next pass re-reads and either applies it or finds it already there.
      return { kind: "failed", error: "the intent changed underneath the update" };
    }

    await markProviderEventProcessed(db, event.id);
    // Outside the transition's transaction, and after it — a socket frame is
    // not durable and must never be sent for a change that did not commit.
    announceIntentChange(updated);
    return { kind: "applied", intentId: updated.id, status: updated.status };
  } catch (error) {
    // Redacted before it is stored: a provider's message quotes the input back,
    // and this column is operator-facing.
    const message = redactProviderMessage(
      error instanceof Error ? error.message : "unknown processing error",
    );
    await markProviderEventFailed(db, event.id, message).catch(() => undefined);
    return { kind: "failed", error: message };
  }
}

/**
 * An account changed at the provider: re-read it.
 *
 * This is what makes a seller's readiness arrive without anyone polling — and
 * the reason `card_payments` is requested beside transfers, because a
 * recipient-only account emits none of these at all (Mercaria's ADR 0008 D2-D).
 * A deployment that dropped that capability would find this handler correct and
 * never invoked.
 */
async function handleAccountEvent(
  db: ReturnType<typeof getDb>,
  event: ProviderEventRow,
): Promise<ProcessOutcome> {
  const providerAccountId = event.objectIds[ACCOUNT_OBJECT_KEY] ?? event.providerAccountId;
  if (!providerAccountId) {
    await markProviderEventFailed(db, event.id, `no ${ACCOUNT_OBJECT_KEY} id on a ${event.type}`);
    return { kind: "failed", error: `no ${ACCOUNT_OBJECT_KEY} id on a ${event.type}` };
  }

  const account = await findAccountByProviderAccountId(
    db,
    event.provider as ProviderId,
    providerAccountId,
  );
  if (!account) {
    /**
     * An account this gateway never opened.
     *
     * Left UNPROCESSED, the same as an unmatched payment, and for the same
     * reason: the overwhelmingly likely cause is that our own create has not
     * committed yet. The other cause — a connected account belonging to a
     * different platform integration on the same Stripe account — resolves the
     * same way from here: it stays, visibly, for an operator.
     */
    return { kind: "unmatched" };
  }

  await refreshConnectedAccount(account);
  await markProviderEventProcessed(db, event.id);
  return { kind: "applied", intentId: account.id, status: "account_refreshed" };
}

/**
 * A transfer changed at the provider.
 *
 * The cumulative reversed total is read from the stored payload, which is legal
 * precisely because `amount_reversed` is on the redaction allow-list — see this
 * file's header. Anything else about the transfer is not read, and must not be:
 * the fields that were dropped read as `"[redacted]"`, not as missing.
 */
async function handleTransferEvent(
  db: ReturnType<typeof getDb>,
  event: ProviderEventRow,
): Promise<ProcessOutcome> {
  const transferObjectId = event.objectIds[TRANSFER_OBJECT_KEY];
  if (!transferObjectId) {
    await markProviderEventFailed(db, event.id, `no ${TRANSFER_OBJECT_KEY} id on a ${event.type}`);
    return { kind: "failed", error: `no ${TRANSFER_OBJECT_KEY} id on a ${event.type}` };
  }

  const transfer = await findTransferByProviderObject(
    db,
    event.provider as ProviderId,
    transferObjectId,
  );
  if (!transfer) return { kind: "unmatched" };

  const total = readReversedTotal(event.payload);
  if (total === null) {
    // The event names a transfer we have but carries no usable total. Recorded
    // rather than skipped: it means the allow-list and this handler disagree,
    // which is a bug here and not at the provider.
    await markProviderEventFailed(db, event.id, `no usable amount_reversed on a ${event.type}`);
    return { kind: "failed", error: `no usable amount_reversed on a ${event.type}` };
  }

  const updated = await applyTransferReversal(db, transfer.id, total);
  await markProviderEventProcessed(db, event.id);
  // `null` means the stored total was already at least this one — an
  // out-of-order delivery, which is ordinary and not a failure.
  return updated
    ? { kind: "applied", intentId: updated.id, status: updated.status }
    : { kind: "noop", intentId: transfer.id };
}

/**
 * The cumulative reversed total out of a stored Stripe transfer event.
 *
 * Returns `null` rather than guessing. Stripe reports it as a NUMBER of minor
 * units; the column holds a canonical integer string, so the conversion is
 * explicit and refuses anything that is not a safe non-negative integer —
 * `"[redacted]"` and a float both land here and both must not become an amount.
 */
function readReversedTotal(payload: Record<string, unknown>): string | null {
  const data = payload.data;
  if (typeof data !== "object" || data === null) return null;
  const object = (data as Record<string, unknown>).object;
  if (typeof object !== "object" || object === null) return null;
  const value = (object as Record<string, unknown>).amount_reversed;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return String(value);
}

/**
 * A refund the provider reports.
 *
 * Only a refund this gateway ALREADY has a row for is acted on. A refund made
 * entirely outside Peable — from the provider's own dashboard — has no row
 * here, and inventing one would put an amount in this database that nothing
 * chose: the row carries a merchant `external_ref`, which is the merchant's
 * identifier for a refund they did not make and cannot supply. Such an event
 * stays visible and unprocessed for an operator, which is the honest outcome.
 */
async function handleRefundEvent(
  db: ReturnType<typeof getDb>,
  event: ProviderEventRow,
): Promise<ProcessOutcome> {
  const refundObjectId = event.objectIds.refund;
  if (!refundObjectId) {
    // `charge.refunded` names the CHARGE, not the refund. Nothing to act on
    // here without a refund id, and the payment's own status is already driven
    // by the refund rows — so this is handled rather than failed.
    await markProviderEventProcessed(db, event.id);
    return { kind: "no_mapping" };
  }

  const refund = await findRefundByProviderObject(
    db,
    event.provider as ProviderId,
    refundObjectId,
  );
  if (!refund) return { kind: "unmatched" };

  const intent = await findIntentById(db, refund.paymentIntentId);
  if (!intent) {
    await markProviderEventFailed(db, event.id, "the refund names an intent that cannot be read");
    return { kind: "failed", error: "the refund names an intent that cannot be read" };
  }

  const status = await applyRefundToIntent(intent);
  await markProviderEventProcessed(db, event.id);
  return { kind: "applied", intentId: intent.id, status };
}

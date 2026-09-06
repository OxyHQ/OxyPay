/**
 * What a stored provider event MEANS.
 *
 * The other half of ADR 0001 D11's split: `ingress.ts` decides whether a
 * delivery is authentic and writes it down; this decides what it does to a
 * payment. They are separate because the provider is waiting on the first and
 * must not be waiting on the second — an event whose handling fails is a row to
 * retry, not a delivery to re-request.
 *
 * **Nothing here trusts the payload.** The stored body has been through
 * `redactProviderPayload`, which is an allow-list, so most of it is gone by
 * design — and even the parts that survive are the provider's account of
 * events, kept for a human to read. Every decision below is made from
 * `object_ids` and `type`, which the ingress derived at verification time from
 * the signed envelope.
 */
import type { ProviderEventRow } from "../../db/providers/providerEventRepository";
import {
  markProviderEventFailed,
  markProviderEventProcessed,
} from "../../db/providers/providerEventRepository";
import { findIntentByProviderObject } from "../../db/payments/paymentIntentRepository";
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

/**
 * Advancing an intent, and telling the merchant about it, as ONE commit.
 *
 * This module exists because of the ordering, not because of the convenience.
 * Every path that moves an intent used to update the row and then, separately,
 * try to POST a webhook — so a crash, a deploy or a lost connection between
 * those two steps left the intent settled and the merchant never told, with
 * nothing anywhere recording that an event had been owed. ADR 0001 D7: the
 * state change and the outbox row commit together or neither happens.
 *
 * The realtime emit deliberately stays OUTSIDE the transaction and after it. A
 * socket frame is not durable, cannot be rolled back, and must never be sent
 * for a transition that then failed to commit.
 */
import type {
  PaymentIntentStatus,
  WebhookEventType,
} from "@peable.to/shared-types";
import { getDb } from "../db/postgres";
import { findWebhookTarget } from "../db/merchants/merchantRepository";
import {
  updateIntentState,
  type IntentStateChange,
  type PaymentIntentRow,
} from "../db/payments/paymentIntentRepository";
import { enqueueWebhook } from "../db/webhooks/webhookOutboxRepository";
import { emitIntentUpdateToActive } from "../realtime/socket";
import { toPaymentIntentDTO } from "../lib/serialize";
import { buildEvent } from "./webhookDispatcher";
import { kickWebhookOutbox } from "./webhookOutbox";

/**
 * Which statuses a merchant is told about.
 *
 * The pre-payment statuses (`created`, `awaiting_approval`, `approved`,
 * `broadcast`, `requires_action`, `processing`) emit nothing: they describe a
 * payer moving through a flow, and a merchant integrating on Stripe-shaped
 * ergonomics acts on outcomes. Moved here from `server.ts` because the outbox
 * write is now part of the transition rather than part of the server's fan-out.
 */
export const WEBHOOK_EVENT_FOR: Partial<
  Record<PaymentIntentStatus, WebhookEventType>
> = {
  confirming: "payment_intent.confirming",
  settled: "payment_intent.settled",
  failed: "payment_intent.failed",
  rejected: "payment_intent.rejected",
  expired: "payment_intent.expired",
  // A refund is an OUTCOME, which is the line this map draws: the pre-payment
  // statuses describe a payer moving through a flow and emit nothing, while
  // money leaving again is something a merchant acts on.
  refunded: "payment_intent.refunded",
  partially_refunded: "payment_intent.partially_refunded",
};

/**
 * Apply a state change and enqueue the merchant's event in the same
 * transaction.
 *
 * @returns the updated row, or `null` when no row matched — which is not an
 *   error: a row that vanished between a poll and this update is the settlement
 *   watcher's ordinary race, and the caller decides what that means.
 */
export async function transitionIntent(
  intentId: string,
  change: IntentStateChange,
): Promise<PaymentIntentRow | null> {
  return getDb().transaction(async (tx) => {
    const row = await updateIntentState(tx, intentId, change);
    if (!row) return null;

    const eventType = WEBHOOK_EVENT_FOR[row.status];
    if (eventType === undefined) return row;

    // The one read allowed to select `webhook_secret`. Only the URL is used
    // here — the secret is re-read at attempt time, so a merchant who rotates
    // it mid-backoff has their retries signed with the new one.
    const target = await findWebhookTarget(tx, row.merchantId);
    if (!target) return row;

    await enqueueWebhook(tx, {
      merchantId: row.merchantId,
      paymentIntentId: row.id,
      event: buildEvent(eventType, toPaymentIntentDTO(row)),
      url: target.url,
    });

    return row;
  });
}

/**
 * Announce a committed transition on the transports that are not durable.
 *
 * Called AFTER `transitionIntent` returns, never inside it. Both halves are
 * fire-and-forget by design:
 *
 * - the socket frame reaches whoever is watching right now, and nobody
 *   watching is not a failure;
 * - the outbox kick just asks the dispatcher to run its next pass early, so a
 *   merchant does not wait a poll interval for an event that is already
 *   durably enqueued. If the kick never happens, the loop picks the row up on
 *   its own — which is exactly why the enqueue had to be in the transaction and
 *   this does not.
 */
export function announceIntentChange(intent: PaymentIntentRow): void {
  emitIntentUpdateToActive(intent);
  kickWebhookOutbox();
}

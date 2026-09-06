import { and, desc, eq, lt } from 'drizzle-orm';
import type { WebhookDeliveryStatus, WebhookEventType } from '@peable.to/shared-types';
import { paymentIntents, webhookDeliveries } from '../schema';
import type { DatabaseOrTransaction } from '../postgres';

/**
 * READS for `webhook_deliveries` — what the merchant API and the dashboard ask
 * about a delivery.
 *
 * The writes moved to `webhookOutboxRepository.ts` when delivery became an
 * outbox (ADR 0001 D7), and `insertWebhookDelivery` went with them: a row is
 * now created by `enqueueWebhook` BEFORE any attempt and updated by
 * `recordDeliveryAttempt` after each one. There is deliberately no function
 * here that writes a finished delivery in one shot — that shape is what made
 * the old inline delivery possible, and re-adding it would let a caller record
 * an outcome for an attempt the dispatcher never made.
 */

export interface WebhookDeliveryRow {
  readonly id: string;
  readonly merchantId: string;
  readonly paymentIntentId: string;
  readonly eventId: string;
  readonly eventType: WebhookEventType;
  /** The event envelope as enqueued — replayed verbatim, never rebuilt. */
  readonly payload: Record<string, unknown>;
  readonly url: string;
  readonly attempts: number;
  readonly delivered: boolean;
  readonly lastStatus: WebhookDeliveryStatus;
  /** Why the last attempt did not succeed. `null` while pending or delivered. */
  readonly lastError: string | null;
  /** When the next attempt is due. `null` exactly when the row is terminal. */
  readonly nextAttemptAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const DELIVERY_COLUMNS = {
  id: webhookDeliveries.id,
  merchantId: webhookDeliveries.merchantId,
  paymentIntentId: webhookDeliveries.paymentIntentId,
  eventId: webhookDeliveries.eventId,
  eventType: webhookDeliveries.eventType,
  payload: webhookDeliveries.payload,
  url: webhookDeliveries.url,
  attempts: webhookDeliveries.attempts,
  delivered: webhookDeliveries.delivered,
  lastStatus: webhookDeliveries.lastStatus,
  lastError: webhookDeliveries.lastError,
  nextAttemptAt: webhookDeliveries.nextAttemptAt,
  createdAt: webhookDeliveries.createdAt,
  updatedAt: webhookDeliveries.updatedAt,
} as const;

function toDeliveryRow(row: {
  eventType: string;
  lastStatus: string;
  [key: string]: unknown;
}): WebhookDeliveryRow {
  return {
    ...row,
    eventType: row.eventType as WebhookEventType,
    lastStatus: row.lastStatus as WebhookDeliveryStatus,
  } as unknown as WebhookDeliveryRow;
}

/** The same two narrowings, over the joined shape. */
function toDeliveryWithIntentRow(row: {
  eventType: string;
  lastStatus: string;
  intentPublicId: string;
  [key: string]: unknown;
}): WebhookDeliveryWithIntentRow {
  return {
    ...row,
    eventType: row.eventType as WebhookEventType,
    lastStatus: row.lastStatus as WebhookDeliveryStatus,
  } as unknown as WebhookDeliveryWithIntentRow;
}

/**
 * One delivery, scoped to the merchant that owns it — the redelivery path's
 * lookup. Ownership is in the WHERE clause, so a foreign delivery 404s exactly
 * like a missing one.
 */
export async function findDeliveryForMerchant(
  db: DatabaseOrTransaction,
  id: string,
  merchantId: string
): Promise<WebhookDeliveryRow | null> {
  const [row] = await db
    .select(DELIVERY_COLUMNS)
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.id, id), eq(webhookDeliveries.merchantId, merchantId)));
  return row ? toDeliveryRow(row) : null;
}

export interface ListDeliveriesParams {
  readonly merchantId: string;
  readonly limit: number;
  /** The cursor row's id, already resolved and ownership-checked by the caller. */
  readonly after?: string | undefined;
}

/**
 * A delivery plus the one field of its intent the DTO needs.
 *
 * `WebhookDelivery.intentId` on the wire is the public `pi_…`, and this row
 * carries the internal reference — so the serializer needs both, and the list
 * path has no other way to get the public one.
 */
export interface WebhookDeliveryWithIntentRow extends WebhookDeliveryRow {
  /** The `pi_…` of the intent `paymentIntentId` points at. */
  readonly intentPublicId: string;
}

/**
 * One page of a merchant's delivery log, newest first, each row carrying its
 * intent's PUBLIC id.
 *
 * ## Why the join is here and not in the caller
 *
 * `WebhookDelivery.intentId` is a shipped wire field and it holds the public
 * `pi_…` — the SDK and the dashboard both read it. The stored reference is the
 * intent's primary key, so somebody has to translate, and `routes/dashboard.ts`
 * maps the serializer over a PAGE: doing it in the route is one query per row,
 * an N+1 whose size the client chooses through `limit`. The two alternatives are
 * worse — a batched second query in the route puts half of one read in two
 * places, and dropping the field from the DTO is a breaking change to consumers
 * that already parse it. So the repository answers the question completely, in
 * one statement.
 *
 * INNER join, and it cannot drop a row: `payment_intent_id` is `NOT NULL` and
 * references `payment_intents.id`, a primary key, so every delivery has exactly
 * one intent and the page size is unchanged by the join. `hasMore` still comes
 * from the `limit + 1` overflow rather than a `count(*)` — and note there is no
 * aggregate anywhere in this module, which is why nothing here has to undo
 * postgres.js decoding an `int8` sum as a string.
 *
 * The Mongo route guarded its cursor with `mongoose.isValidObjectId` before
 * looking it up. That guard is DELETED rather than widened: its only job was to
 * reject a value that could not be an ObjectId, and the ownership-scoped lookup
 * the caller already performs answers the same question correctly for any input
 * — an unknown cursor is a 422 whatever shape it had.
 */
export async function listDeliveriesForMerchant(
  db: DatabaseOrTransaction,
  params: ListDeliveriesParams
): Promise<{ data: WebhookDeliveryWithIntentRow[]; hasMore: boolean }> {
  const conditions = [eq(webhookDeliveries.merchantId, params.merchantId)];
  if (params.after !== undefined) conditions.push(lt(webhookDeliveries.id, params.after));

  const rows = await db
    .select({ ...DELIVERY_COLUMNS, intentPublicId: paymentIntents.publicId })
    .from(webhookDeliveries)
    .innerJoin(paymentIntents, eq(paymentIntents.id, webhookDeliveries.paymentIntentId))
    .where(and(...conditions))
    .orderBy(desc(webhookDeliveries.id))
    .limit(params.limit + 1);

  const hasMore = rows.length > params.limit;
  return {
    data: (hasMore ? rows.slice(0, params.limit) : rows).map(toDeliveryWithIntentRow),
    hasMore,
  };
}

import { and, desc, eq, lt } from 'drizzle-orm';
import type { WebhookEventType } from '@oxypay/shared-types';
import { uuidv7 } from '@oxyhq/db';
import { webhookDeliveries } from '../schema';
import type { DatabaseOrTransaction } from '../postgres';

/**
 * Reads and writes for `webhook_deliveries` — the append-only log of delivery
 * attempts.
 *
 * NOT WIRED TO ANY ROUTE YET; see `db/merchants/merchantRepository.ts`'s header.
 */

export interface WebhookDeliveryRow {
  readonly id: string;
  readonly merchantId: string;
  readonly paymentIntentId: string;
  readonly eventId: string;
  readonly eventType: WebhookEventType;
  readonly url: string;
  readonly attempts: number;
  readonly delivered: boolean;
  readonly lastStatus: 'delivered' | 'failed';
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const DELIVERY_COLUMNS = {
  id: webhookDeliveries.id,
  merchantId: webhookDeliveries.merchantId,
  paymentIntentId: webhookDeliveries.paymentIntentId,
  eventId: webhookDeliveries.eventId,
  eventType: webhookDeliveries.eventType,
  url: webhookDeliveries.url,
  attempts: webhookDeliveries.attempts,
  delivered: webhookDeliveries.delivered,
  lastStatus: webhookDeliveries.lastStatus,
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
    lastStatus: row.lastStatus as 'delivered' | 'failed',
  } as unknown as WebhookDeliveryRow;
}

export interface InsertWebhookDeliveryParams {
  readonly merchantId: string;
  /** The INTERNAL id of the intent the event was about, not its `pi_…`. */
  readonly paymentIntentId: string;
  readonly eventId: string;
  readonly eventType: WebhookEventType;
  readonly url: string;
  readonly attempts: number;
  readonly delivered: boolean;
}

/**
 * Record one delivery attempt set.
 *
 * `last_status` is DERIVED here from `delivered` rather than accepted from the
 * caller, which is why the parameters have no field for it. Both original
 * writers computed it the same way, and `webhook_deliveries_status_agrees_check`
 * refuses the pair disagreeing — so deriving it at the single write point means
 * the constraint can never be the thing that fails.
 */
export async function insertWebhookDelivery(
  db: DatabaseOrTransaction,
  params: InsertWebhookDeliveryParams
): Promise<WebhookDeliveryRow> {
  const [row] = await db
    .insert(webhookDeliveries)
    .values({
      id: uuidv7(),
      merchantId: params.merchantId,
      paymentIntentId: params.paymentIntentId,
      eventId: params.eventId,
      eventType: params.eventType,
      url: params.url,
      attempts: params.attempts,
      delivered: params.delivered,
      lastStatus: params.delivered ? 'delivered' : 'failed',
    })
    .returning(DELIVERY_COLUMNS);
  if (!row) throw new Error('webhook delivery insert returned no row');
  return toDeliveryRow(row);
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
 * One page of a merchant's delivery log, newest first.
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
): Promise<{ data: WebhookDeliveryRow[]; hasMore: boolean }> {
  const conditions = [eq(webhookDeliveries.merchantId, params.merchantId)];
  if (params.after !== undefined) conditions.push(lt(webhookDeliveries.id, params.after));

  const rows = await db
    .select(DELIVERY_COLUMNS)
    .from(webhookDeliveries)
    .where(and(...conditions))
    .orderBy(desc(webhookDeliveries.id))
    .limit(params.limit + 1);

  const hasMore = rows.length > params.limit;
  return { data: (hasMore ? rows.slice(0, params.limit) : rows).map(toDeliveryRow), hasMore };
}

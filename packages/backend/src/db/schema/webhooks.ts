import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, generatedId, inList, updatedAt } from '@oxyhq/db';
import { merchants } from './merchants';
import { paymentIntents } from './payments';
import { WEBHOOK_DELIVERY_STATUSES, WEBHOOK_EVENT_TYPES } from './valueSets';

/**
 * One webhook delivery ATTEMPT SET — a row per `deliver()` call, carrying how
 * many HTTP attempts it made and how it ended.
 *
 * Keyed by merchant rather than by "the" webhook: today a merchant has one
 * endpoint (`merchants.webhook_url`/`webhook_secret`), and if that ever becomes
 * N endpoints with event filters, this log gains an `endpoint_id` rather than
 * being rewritten.
 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: generatedId(),
    merchantId: text()
      .notNull()
      .references(() => merchants.id, { onDelete: 'restrict' }),
    /**
     * The intent the event was about. Holds the intent's PRIMARY KEY; the Mongo
     * field held the public `pi_…` id, and the serializer renders that from the
     * join.
     *
     * `cascade`, unlike every other reference in this schema: a delivery log is
     * derived from its intent and has no meaning without it, where an intent is
     * the money record and a merchant is the party. Nothing deletes an intent
     * today; this states what the consequence would be rather than leaving it
     * to whoever writes that statement.
     */
    paymentIntentId: text()
      .notNull()
      .references(() => paymentIntents.id, { onDelete: 'cascade' }),
    /** The `evt_…` envelope id that was signed and sent. Not a row anywhere — events are not persisted. */
    eventId: text().notNull(),
    eventType: text().notNull(),
    /** The URL actually POSTed to, snapshotted — a merchant may change theirs afterwards. */
    url: text().notNull(),
    attempts: integer().notNull(),
    delivered: boolean().notNull(),
    lastStatus: text().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('webhook_deliveries_merchant_id_idx').on(table.merchantId),
    check(
      'webhook_deliveries_event_type_check',
      sql.raw(`event_type in (${inList(WEBHOOK_EVENT_TYPES)})`)
    ),
    check(
      'webhook_deliveries_last_status_check',
      sql.raw(`last_status in (${inList(WEBHOOK_DELIVERY_STATUSES)})`)
    ),
    // `deliver()` returns at least one attempt, always — the loop runs its
    // first iteration before it can return.
    check('webhook_deliveries_attempts_check', sql`${table.attempts} > 0`),
    /**
     * `delivered` and `last_status` are two spellings of one fact, and both
     * writers (`server.ts`'s settlement path and `routes/webhookDeliveries.ts`'s
     * redelivery) derive the second from the first. This is that derivation,
     * in the place where the two cannot come apart.
     */
    check(
      'webhook_deliveries_status_agrees_check',
      sql`${table.delivered} = (${table.lastStatus} = 'delivered')`
    ),
  ]
);

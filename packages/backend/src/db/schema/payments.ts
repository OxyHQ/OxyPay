import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createdAt, generatedId, inList, timestamptz, updatedAt } from '@oxyhq/db';
import { merchants } from './merchants';
import {
  BASE_UNIT_STRING_PATTERN,
  CURRENCY_CODES,
  NETWORK_TYPES,
  PAYMENT_INTENT_STATUS_VALUES,
  SERVICE_ENVIRONMENTS,
} from './valueSets';

/**
 * `{}` — the empty metadata bag. Written as a SQL default rather than an
 * application one so a row inserted by a backfill or a repair statement gets
 * the same shape as one inserted through the repository.
 */
const emptyMetadata = sql`'{}'::jsonb`;

/**
 * A payment intent — the money record.
 *
 * `amount` stays a canonical base-unit STRING, as it is on the wire and in
 * `lib/money`. A `bigint` column would be decoded by postgres.js as a string
 * anyway, and an `int8` ceiling is not the domain's: the application works in
 * JS `bigint`, which is unbounded. The CHECK is what a `text` column would
 * otherwise be missing, and it is the same pattern `isBaseUnitString`
 * enforces.
 */
export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: generatedId(),
    /**
     * Public Stripe-parity identifier (`pi_…`), minted by `newId('pi')` — the
     * `id` every API surface and every DTO carries.
     *
     * The Mongo model called this field `id` while the other three public-id
     * tables called theirs `publicId`. One name here, for all four: the
     * primary key is the internal id, `public_id` is the external one.
     */
    publicId: text().notNull(),
    status: text().notNull(),
    amount: text().notNull(),
    currency: text().notNull().default('FAIR'),
    network: text().notNull(),
    /** Watch-only receive address derived per intent from the merchant's xpub. */
    address: text().notNull(),
    merchantId: text().notNull(),
    txid: text(),
    confirmations: integer().notNull().default(0),
    clientSecret: text().notNull(),
    idempotencyKey: text().notNull(),
    metadata: jsonb().$type<Record<string, string>>().notNull().default(emptyMetadata),
    expiresAt: timestamptz().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('payment_intents_public_id_key').on(table.publicId),
    // Stripe-style idempotency: one intent per (merchant, Idempotency-Key).
    // Load-bearing — `createIntent` races on it and converges on the winner
    // rather than reading first.
    uniqueIndex('payment_intents_merchant_id_idempotency_key_key').on(
      table.merchantId,
      table.idempotencyKey
    ),
    // The list route filters and paginates by merchant; the compound unique
    // above is keyed on `idempotency_key` second and cannot serve it.
    index('payment_intents_merchant_id_idx').on(table.merchantId),
    // `services/enrichment.ts` resolves intents by address.
    index('payment_intents_address_idx').on(table.address),
    /**
     * The network firewall, made structural.
     *
     * `createIntent` throws `NetworkMismatchError` when the requested network
     * is not the merchant's, because a `network` label that disagrees with the
     * network the `address` actually encodes sends a payer's funds to an
     * address nobody is watching. This composite reference is that same rule
     * expressed where no future code path can route around it, and its
     * implicit `on update restrict` additionally means a merchant's network
     * cannot be changed out from under an intent that already exists.
     */
    foreignKey({
      name: 'payment_intents_merchant_id_network_fkey',
      columns: [table.merchantId, table.network],
      foreignColumns: [merchants.id, merchants.network],
    }).onDelete('restrict'),
    check(
      'payment_intents_status_check',
      sql.raw(`status in (${inList(PAYMENT_INTENT_STATUS_VALUES)})`)
    ),
    check('payment_intents_currency_check', sql.raw(`currency in (${inList(CURRENCY_CODES)})`)),
    check('payment_intents_network_check', sql.raw(`network in (${inList(NETWORK_TYPES)})`)),
    check('payment_intents_amount_check', sql.raw(`amount ~ '${BASE_UNIT_STRING_PATTERN}'`)),
    check('payment_intents_confirmations_check', sql`${table.confirmations} >= 0`),
    check('payment_intents_metadata_object_check', sql`jsonb_typeof(${table.metadata}) = 'object'`),
    /**
     * A broadcast, confirming or settled intent HAS a transaction id.
     *
     * Verified against every writer rather than assumed: `POST
     * /v1/payment_intents/:id/submit_tx` is the only path to `broadcast` and
     * it sets `txid` in the same write, and `confirming`/`settled` are reached
     * only by the settlement watcher, which selects on `txid` being present.
     * `failed` is deliberately outside the set — `approved → failed` is a legal
     * transition that no writer pairs with a txid.
     */
    check(
      'payment_intents_broadcast_requires_txid_check',
      sql`${table.status} not in ('broadcast', 'confirming', 'settled') or ${table.txid} is not null`
    ),
  ]
);

/**
 * A hosted-checkout session wrapping exactly ONE payment intent.
 *
 * Immutable after creation: there is no PATCH route, and a merchant needing a
 * different amount creates a new session. The wrapped intent's `client_secret`
 * is deliberately not duplicated here — `toCheckoutSessionDTO` reads it off the
 * intent, so there is exactly one place a client secret is ever persisted.
 */
export const checkoutSessions = pgTable(
  'checkout_sessions',
  {
    id: generatedId(),
    /** Public Stripe-parity identifier (`cs_…`), minted by `newId('cs')`. */
    publicId: text().notNull(),
    merchantId: text().notNull(),
    /** Denormalized from the merchant at creation time — held true by the composite reference below. */
    oxyAppId: text().notNull(),
    environment: text().notNull(),
    paymentIntentId: text()
      .notNull()
      .references(() => paymentIntents.id, { onDelete: 'restrict' }),
    amount: text().notNull(),
    network: text().notNull(),
    metadata: jsonb().$type<Record<string, string>>().notNull().default(emptyMetadata),
    successUrl: text(),
    cancelUrl: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('checkout_sessions_public_id_key').on(table.publicId),
    /**
     * "Wraps exactly ONE payment intent" in the only form that cannot be
     * violated. Every session mints a fresh intent today (`createIntent`
     * without a caller `Idempotency-Key`), so this refuses nothing that
     * happens; what it refuses is a future change that lets two sessions share
     * one intent, which is the bug the sentence above exists to prevent.
     */
    uniqueIndex('checkout_sessions_payment_intent_id_key').on(table.paymentIntentId),
    index('checkout_sessions_oxy_app_id_environment_idx').on(table.oxyAppId, table.environment),
    index('checkout_sessions_merchant_id_idx').on(table.merchantId),
    // Denormalization that cannot drift: the three copied fields are carried
    // by the reference itself, so they are the merchant's values or the row
    // does not exist. See `payment_intents`' equivalent for the network half.
    foreignKey({
      name: 'checkout_sessions_merchant_identity_fkey',
      columns: [table.merchantId, table.oxyAppId, table.environment, table.network],
      foreignColumns: [merchants.id, merchants.oxyAppId, merchants.environment, merchants.network],
    }).onDelete('restrict'),
    check(
      'checkout_sessions_environment_check',
      sql.raw(`environment in (${inList(SERVICE_ENVIRONMENTS)})`)
    ),
    check('checkout_sessions_network_check', sql.raw(`network in (${inList(NETWORK_TYPES)})`)),
    check('checkout_sessions_amount_check', sql.raw(`amount ~ '${BASE_UNIT_STRING_PATTERN}'`)),
    check(
      'checkout_sessions_metadata_object_check',
      sql`jsonb_typeof(${table.metadata}) = 'object'`
    ),
  ]
);

/**
 * A shareable, reusable generator of payment intents.
 *
 * A link's price is immutable once shared: only `active`, `metadata` and
 * `success_url` are mutable through `PATCH /v1/payment_links/:id`.
 */
export const paymentLinks = pgTable(
  'payment_links',
  {
    id: generatedId(),
    /** Public Stripe-parity identifier (`link_…`), minted by `newId('link')`. */
    publicId: text().notNull(),
    merchantId: text().notNull(),
    /** Denormalized from the merchant at creation time — held true by the composite reference below. */
    oxyAppId: text().notNull(),
    environment: text().notNull(),
    amount: text().notNull(),
    network: text().notNull(),
    active: boolean().notNull().default(true),
    metadata: jsonb().$type<Record<string, string>>().notNull().default(emptyMetadata),
    successUrl: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('payment_links_public_id_key').on(table.publicId),
    index('payment_links_oxy_app_id_environment_idx').on(table.oxyAppId, table.environment),
    index('payment_links_merchant_id_idx').on(table.merchantId),
    foreignKey({
      name: 'payment_links_merchant_identity_fkey',
      columns: [table.merchantId, table.oxyAppId, table.environment, table.network],
      foreignColumns: [merchants.id, merchants.oxyAppId, merchants.environment, merchants.network],
    }).onDelete('restrict'),
    check(
      'payment_links_environment_check',
      sql.raw(`environment in (${inList(SERVICE_ENVIRONMENTS)})`)
    ),
    check('payment_links_network_check', sql.raw(`network in (${inList(NETWORK_TYPES)})`)),
    check('payment_links_amount_check', sql.raw(`amount ~ '${BASE_UNIT_STRING_PATTERN}'`)),
    check('payment_links_metadata_object_check', sql`jsonb_typeof(${table.metadata}) = 'object'`),
  ]
);

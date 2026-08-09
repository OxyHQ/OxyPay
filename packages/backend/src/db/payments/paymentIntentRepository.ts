import { and, desc, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import type { NetworkType } from '@fairco.in/core';
import type { PaymentIntentStatus } from '@oxypay/shared-types';
import { isUniqueViolation, uuidv7 } from '@oxyhq/db';
import { paymentIntents } from '../schema';
import type { DatabaseOrTransaction } from '../postgres';

/**
 * Reads and writes for `payment_intents` — the money record.
 *
 * NOT WIRED TO ANY ROUTE YET; see `db/merchants/merchantRepository.ts`'s header
 * for why the repositories land before the switch. Do not delete as unreferenced.
 */

export interface PaymentIntentRow {
  readonly id: string;
  readonly publicId: string;
  readonly status: PaymentIntentStatus;
  readonly amount: string;
  readonly currency: 'FAIR';
  readonly network: NetworkType;
  readonly address: string;
  readonly merchantId: string;
  readonly txid: string | null;
  readonly confirmations: number;
  readonly clientSecret: string;
  readonly metadata: Record<string, string>;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * `idempotency_key` is deliberately absent: it is internal, omitted from the
 * DTO, and nothing outside the create path has a use for it. `client_secret`
 * IS here — the payer needs it, and `verifySecret` compares against it.
 */
const INTENT_COLUMNS = {
  id: paymentIntents.id,
  publicId: paymentIntents.publicId,
  status: paymentIntents.status,
  amount: paymentIntents.amount,
  currency: paymentIntents.currency,
  network: paymentIntents.network,
  address: paymentIntents.address,
  merchantId: paymentIntents.merchantId,
  txid: paymentIntents.txid,
  confirmations: paymentIntents.confirmations,
  clientSecret: paymentIntents.clientSecret,
  metadata: paymentIntents.metadata,
  expiresAt: paymentIntents.expiresAt,
  createdAt: paymentIntents.createdAt,
  updatedAt: paymentIntents.updatedAt,
} as const;

interface RawIntentRow {
  readonly status: string;
  readonly currency: string;
  readonly network: string;
  readonly [key: string]: unknown;
}

/** Where the closed-set CHECKs meet TypeScript. Not widenings, and nowhere else to put them. */
function toIntentRow(row: RawIntentRow): PaymentIntentRow {
  return {
    ...row,
    status: row.status as PaymentIntentStatus,
    currency: row.currency as 'FAIR',
    network: row.network as NetworkType,
  } as unknown as PaymentIntentRow;
}

export interface InsertPaymentIntentParams {
  readonly publicId: string;
  readonly merchantId: string;
  readonly amount: string;
  readonly network: NetworkType;
  readonly address: string;
  readonly clientSecret: string;
  readonly idempotencyKey: string;
  readonly metadata: Record<string, string>;
  readonly expiresAt: Date;
}

/**
 * Mint an intent.
 *
 * @returns the new row, or `null` when `(merchant_id, idempotency_key)` already
 *   exists. The caller then re-reads the winner — the race path `createIntent`
 *   already has. Converging on the index rather than reading first is what makes
 *   two concurrent creates with one `Idempotency-Key` produce ONE intent, and
 *   therefore one address, rather than two intents sharing a merchant's counter.
 */
export async function insertPaymentIntent(
  db: DatabaseOrTransaction,
  params: InsertPaymentIntentParams
): Promise<PaymentIntentRow | null> {
  try {
    // Explicit field list, never a spread. `status`, `currency` and
    // `confirmations` take their column defaults: a caller does not get to mint
    // an intent that is already settled.
    const [row] = await db
      .insert(paymentIntents)
      .values({
        id: uuidv7(),
        publicId: params.publicId,
        status: 'created',
        amount: params.amount,
        network: params.network,
        address: params.address,
        merchantId: params.merchantId,
        clientSecret: params.clientSecret,
        idempotencyKey: params.idempotencyKey,
        metadata: params.metadata,
        expiresAt: params.expiresAt,
      })
      .returning(INTENT_COLUMNS);
    return row ? toIntentRow(row) : null;
  } catch (error) {
    if (isUniqueViolation(error, 'payment_intents_merchant_id_idempotency_key_key')) {
      return null;
    }
    throw error;
  }
}

/** The idempotency lookup — both the fast path and the race recovery. */
export async function findIntentByIdempotencyKey(
  db: DatabaseOrTransaction,
  merchantId: string,
  idempotencyKey: string
): Promise<PaymentIntentRow | null> {
  const [row] = await db
    .select(INTENT_COLUMNS)
    .from(paymentIntents)
    .where(
      and(
        eq(paymentIntents.merchantId, merchantId),
        eq(paymentIntents.idempotencyKey, idempotencyKey)
      )
    );
  return row ? toIntentRow(row) : null;
}

/** The PAYER path: `pi_…` alone, authorized by `client_secret` rather than by ownership. */
export async function findIntentByPublicId(
  db: DatabaseOrTransaction,
  publicId: string
): Promise<PaymentIntentRow | null> {
  const [row] = await db
    .select(INTENT_COLUMNS)
    .from(paymentIntents)
    .where(eq(paymentIntents.publicId, publicId));
  return row ? toIntentRow(row) : null;
}

/**
 * The MERCHANT path: `pi_…` scoped to the owner, in ONE predicate.
 *
 * Separate from {@link findIntentByPublicId} rather than a boolean parameter,
 * because the difference is who may see the row. A merchant-authed handler that
 * reached for the unscoped read would return another merchant's intent — an
 * IDOR — and the two names are what makes that visible in a diff. The ownership
 * check is in the WHERE clause, never a comparison after the read, so a missing
 * row and a foreign row are indistinguishable to the caller and both 404.
 */
export async function findIntentForMerchant(
  db: DatabaseOrTransaction,
  publicId: string,
  merchantId: string
): Promise<PaymentIntentRow | null> {
  const [row] = await db
    .select(INTENT_COLUMNS)
    .from(paymentIntents)
    .where(
      and(eq(paymentIntents.publicId, publicId), eq(paymentIntents.merchantId, merchantId))
    );
  return row ? toIntentRow(row) : null;
}

export interface ListIntentsParams {
  readonly merchantId: string;
  readonly status?: PaymentIntentStatus | undefined;
  readonly limit: number;
  /** The internal id of the `starting_after` cursor row, already resolved and ownership-checked. */
  readonly after?: string | undefined;
}

/**
 * One page, newest first, plus whether another exists.
 *
 * Ordered by the PRIMARY KEY descending — the port of Mongo's `.sort({_id: -1})`.
 * Two separate properties, and only one of them is total:
 *
 *  - **Pagination is exact.** The key is unique and the order is total, so a
 *    keyset walk never repeats or skips a row, whatever the ids happen to be.
 *    Ordering by `created_at` instead would need a tiebreaker and would skip
 *    rows sharing a millisecond with a page boundary.
 *  - **Creation order holds only to the MILLISECOND.** A uuid v7 leads with 48
 *    bits of big-endian milliseconds and `@oxyhq/db`'s generator fills the rest
 *    with randomness — RFC 9562's optional monotonic counter is not used. So
 *    two rows minted in the same millisecond come back in arbitrary relative
 *    order. Measured: 94 of 200 same-millisecond pairs invert, which is the
 *    coin flip you would expect rather than a rare edge.
 *
 * That is a real difference from Mongo, where an ObjectId carries a per-process
 * counter and is therefore monotonic within its one-second timestamp. Nothing
 * in this API promises sub-millisecond ordering, and the pagination contract is
 * unaffected — but do not restate this as "primary-key order is creation order",
 * because at the resolution that matters it is not.
 *
 * Fetches `limit + 1` and reports `hasMore` from the overflow rather than
 * counting, so a page costs one indexed scan and no `count(*)`.
 */
export async function listIntentsForMerchant(
  db: DatabaseOrTransaction,
  params: ListIntentsParams
): Promise<{ data: PaymentIntentRow[]; hasMore: boolean }> {
  const conditions = [eq(paymentIntents.merchantId, params.merchantId)];
  if (params.status !== undefined) conditions.push(eq(paymentIntents.status, params.status));
  if (params.after !== undefined) conditions.push(lt(paymentIntents.id, params.after));

  const rows = await db
    .select(INTENT_COLUMNS)
    .from(paymentIntents)
    .where(and(...conditions))
    .orderBy(desc(paymentIntents.id))
    .limit(params.limit + 1);

  const hasMore = rows.length > params.limit;
  return {
    data: (hasMore ? rows.slice(0, params.limit) : rows).map(toIntentRow),
    hasMore,
  };
}

/**
 * The enrichment lookup: which intents claim these addresses.
 *
 * `inArray`, not a `sql` template holding the array. A bare `${array}` inside a
 * `sql` template renders as a ROW CONSTRUCTOR, which Postgres rejects outright —
 * a runtime error `tsc` cannot see. An empty input short-circuits, because
 * `inArray` with no values builds `in ()`, which is a syntax error rather than
 * the empty result the caller means.
 */
export async function findIntentsByAddresses(
  db: DatabaseOrTransaction,
  addresses: readonly string[]
): Promise<PaymentIntentRow[]> {
  if (addresses.length === 0) return [];
  const rows = await db
    .select(INTENT_COLUMNS)
    .from(paymentIntents)
    .where(inArray(paymentIntents.address, [...addresses]));
  return rows.map(toIntentRow);
}

/**
 * What the settlement watcher polls: in-flight intents carrying a payer-reported
 * txid. Terminal and pre-broadcast intents are never watched, and an intent with
 * no txid has nothing to look up on chain.
 */
export async function findWatchableIntents(
  db: DatabaseOrTransaction,
  statuses: readonly PaymentIntentStatus[]
): Promise<PaymentIntentRow[]> {
  if (statuses.length === 0) return [];
  const rows = await db
    .select(INTENT_COLUMNS)
    .from(paymentIntents)
    .where(
      and(inArray(paymentIntents.status, [...statuses]), isNotNull(paymentIntents.txid))
    );
  return rows.map(toIntentRow);
}

export interface IntentStateChange {
  readonly status: PaymentIntentStatus;
  readonly txid?: string | undefined;
  readonly confirmations?: number | undefined;
}

/**
 * Advance an intent's state.
 *
 * The transition itself is decided by `services/intentState.ts`; this only
 * records the outcome. `txid` is part of the SAME statement rather than a second
 * write, which is what keeps `payment_intents_broadcast_requires_txid_check`
 * satisfiable: moving to `broadcast` without the txid alongside it is refused by
 * the database, not merely by convention.
 */
export async function updateIntentState(
  db: DatabaseOrTransaction,
  id: string,
  change: IntentStateChange
): Promise<PaymentIntentRow | null> {
  const values: Record<string, string | number> = { status: change.status };
  if (change.txid !== undefined) values.txid = change.txid;
  if (change.confirmations !== undefined) values.confirmations = change.confirmations;

  const [row] = await db
    .update(paymentIntents)
    .set(values)
    .where(eq(paymentIntents.id, id))
    .returning(INTENT_COLUMNS);
  return row ? toIntentRow(row) : null;
}

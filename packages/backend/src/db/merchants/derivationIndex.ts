import { eq, sql } from 'drizzle-orm';
import type { NetworkType } from '@fairco.in/core';
import { merchants } from '../schema';
import type { DatabaseOrTransaction } from '../postgres';

/**
 * A derivation index this call, and no other call, owns — together with the
 * key material needed to derive its address, read in the same statement.
 */
export interface ReservedDerivationIndex {
  readonly index: number;
  readonly xpub: string;
  readonly network: NetworkType;
}

/**
 * Claim the merchant's next BIP32 child index, atomically.
 *
 * ## Why this is one statement and not a read followed by a write
 *
 * The index this returns becomes a receive address a payer sends money to. Two
 * callers receiving the same index derive the SAME address, so two payments
 * land on one address and the gateway cannot tell them apart. A
 * read-modify-write leaves exactly that window open; `UPDATE … SET x = x + 1`
 * takes the row lock and does not.
 *
 * `RETURNING next_derivation_index - 1` is the PRE-increment value — the index
 * this call reserved — and is the direct port of Mongo's `findOneAndUpdate({
 * $inc }, { new: false })`. Getting that `- 1` wrong hands out an index one
 * higher than the one recorded, so the address a payer is shown is not the
 * address the next reservation avoids.
 *
 * ## The type of what comes back
 *
 * `integer`, so postgres.js decodes it as a JS `number`. This matters more than
 * it looks: postgres.js decodes `int8` to a STRING, so a `bigint` column would
 * make `index + 1` string CONCATENATION ("0" + 1 = "01") and derive a
 * completely different address. `int4` is also the real domain — a non-hardened
 * BIP32 child index is bounded by 2^31 − 1 — so exhausting it raises `22003`
 * and refuses the reservation instead of wrapping to an index already handed
 * out. `db/__tests__/derivationIndex.realdb.test.ts` pins both the type and two
 * CONSECUTIVE reservations, because a single reservation cannot tell a number
 * from a string that happens to print the same.
 *
 * @returns `null` when no merchant has that id — nothing was reserved.
 */
export async function reserveNextDerivationIndex(
  db: DatabaseOrTransaction,
  merchantId: string
): Promise<ReservedDerivationIndex | null> {
  const [row] = await db
    .update(merchants)
    .set({ nextDerivationIndex: sql`${merchants.nextDerivationIndex} + 1` })
    .where(eq(merchants.id, merchantId))
    .returning({
      index: sql<number>`${merchants.nextDerivationIndex} - 1`,
      xpub: merchants.xpub,
      network: merchants.network,
    });

  if (!row) return null;
  // `network` is `text` in the schema and a closed set in the database (the
  // `merchants_network_check` CHECK). The cast is where those two facts meet;
  // it is not a widening.
  return { index: row.index, xpub: row.xpub, network: row.network as NetworkType };
}

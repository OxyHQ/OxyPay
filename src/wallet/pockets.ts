/**
 * Pockets — BIP44 sub-accounts within a single FairCoin wallet.
 *
 * A Pocket is one BIP44 `account` index under the wallet's HD seed, giving it
 * its own address space, UTXO set, and SQLite database (see
 * `../storage/db-name.ts`). Account 0 is the implicit "main" Pocket every
 * wallet already has — pre-Pockets wallets need no migration.
 *
 * Kept pure (no expo-sqlite / storage imports) so it is unit-testable on its
 * own and safe to import from both `../storage/pockets-store.ts`
 * (persistence) and any UI layer.
 */

/** BIP44 account index of the implicit main Pocket every wallet has. */
export const MAIN_POCKET_ACCOUNT = 0;

/** A Pocket's registry entry: name + creation metadata for a BIP44 account. */
export interface PocketInfo {
  account: number;
  name: string;
  createdAt: number;
}

/**
 * Normalize a Pocket registry: always includes the main Pocket (account 0,
 * synthesized if missing), drops duplicate account indices (first occurrence
 * wins), and sorts by account ascending so callers get a stable order.
 */
export function normalizePockets(pockets: PocketInfo[]): PocketInfo[] {
  const byAccount = new Map<number, PocketInfo>();
  for (const pocket of pockets) {
    if (!byAccount.has(pocket.account)) {
      byAccount.set(pocket.account, pocket);
    }
  }
  if (!byAccount.has(MAIN_POCKET_ACCOUNT)) {
    byAccount.set(MAIN_POCKET_ACCOUNT, {
      account: MAIN_POCKET_ACCOUNT,
      name: "Main",
      createdAt: 0,
    });
  }
  return Array.from(byAccount.values()).sort((a, b) => a.account - b.account);
}

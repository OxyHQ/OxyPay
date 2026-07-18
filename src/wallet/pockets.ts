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
  /** BIP44 account index. 0 is the main Pocket and can never be deleted. */
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
    if (!Number.isInteger(pocket.account) || pocket.account < 0) continue;
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

/** The account index a newly-created Pocket should use: max(account) + 1. */
export function nextAccountIndex(list: PocketInfo[]): number {
  return list.reduce((max, p) => Math.max(max, p.account), 0) + 1;
}

/** Find a Pocket by account index. */
export function findPocket(
  list: PocketInfo[],
  account: number,
): PocketInfo | undefined {
  return list.find((p) => p.account === account);
}

/** Append a new Pocket at the next free account index. */
export function addPocket(
  list: PocketInfo[],
  name: string,
  now: number,
): PocketInfo[] {
  const account = nextAccountIndex(list);
  return normalizePockets([...list, { account, name, createdAt: now }]);
}

/** Rename the Pocket at `account`, leaving all others untouched. */
export function renamePocket(
  list: PocketInfo[],
  account: number,
  name: string,
): PocketInfo[] {
  return normalizePockets(
    list.map((p) => (p.account === account ? { ...p, name } : p)),
  );
}

/** Remove the Pocket at `account`. The main Pocket can never be removed. */
export function removePocket(
  list: PocketInfo[],
  account: number,
): PocketInfo[] {
  if (account === MAIN_POCKET_ACCOUNT) return normalizePockets(list);
  return normalizePockets(list.filter((p) => p.account !== account));
}

/** Whether a Pocket may be deleted: it exists and is not the main Pocket. */
export function canDeletePocket(list: PocketInfo[], account: number): boolean {
  return account !== MAIN_POCKET_ACCOUNT && findPocket(list, account) !== undefined;
}

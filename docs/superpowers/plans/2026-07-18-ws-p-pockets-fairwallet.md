# Pockets (FAIRWallet) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Revolut-style Pockets (sub-balances) to FAIRWallet by parametrising the wallet on a BIP44 account index, so one seed backs N fully-isolated on-chain sub-wallets, with a Pockets UI to create/switch/rename/delete pockets and move funds between them.

**Architecture:** A "pocket" is a BIP44 **account index** (`m/44'/coin'/account'`) inside one wallet's seed. Each pocket is an isolated BIP32 subtree with its own external/change branches, gap-limit cursors, xpub, SQLite database file, and UTXO set. The wallet-store module globals (`keyManager`/`utxoSet`/`database`/`spvClient`) point at the **active** pocket; switching pockets tears down and re-initialises them for the new account — the exact mechanism the existing multi-wallet `switchWallet` already uses. Account `0` keeps the legacy database filename and behaviour, so existing single-account wallets are byte-for-byte backward-compatible. Moving funds between pockets is an ordinary on-chain self-transfer that reuses the existing `sendTransaction`/`buildTransaction` path — no new transaction primitive.

**Tech Stack:** TypeScript, Bun (`bun test`), `@scure/bip32`, `@fairco.in/core` (HD wallet, address encoding, networks), `@noble/hashes`, Zustand (`wallet-store`), expo-sqlite (via `src/storage/database.ts`), expo-secure-store (via `src/storage/kv-store.ts`), Expo SDK 57 / RN 0.86 / expo-router, NativeWind 5 + `@oxyhq/bloom`.

## Global Constraints

- **Self-custody / keys-on-device only.** Private keys are derived and held only on-device; nothing here weakens that. Pockets share the one on-device seed.
- **Generic, no Oxy dependency.** This lands in FAIRWallet upstream and is later `git subtree pull`ed into OxyPay. Do NOT import any `@oxyhq/*` identity/session code, DID, or Oxy username concept in this work — Pockets is pure BIP44/wallet-core + UI.
- **Backward-compatible single-account.** Every existing entry point that omits an `account` must behave exactly as today (account `0`, legacy DB filenames, same addresses). All new params default to `0`.
- **Upstream-first.** Implement in `~/FairCoinWorkspace/FAIRWallet` (repo `FairCoinOfficial/FAIRWallet`, current branch `chore/expo-sdk-57`). Branch from it (`feat/pockets`), land there, then subtree-pull into OxyPay (Task 6). Never patch this into OxyPay directly.
- **bun only.** Use `bun test` / `bun run typecheck` / `bunx`. Never npm/yarn/npx.
- **No `as any`, no `@ts-ignore`/`@ts-expect-error`, no `!` non-null assertions, no silent `catch {}`, no `var`, no `console.log`, no TODO/FIXME.** Handle null/undefined with guards. NativeWind classes for styling (no inline styles where a class exists).
- **Native verify on a real foregrounded device/emulator.** Jest/tsc do NOT catch render/navigation/layout races; the Pockets UI (Task 5) and the on-chain move (Task 4) must be verified on a foregrounded device/emulator, on **testnet**, before "done".

---

## File Structure

**Created:**
- `src/storage/db-name.ts` — pure, expo-free helper that maps `(walletId?, account)` → SQLite filename. Encodes the account-0 backward-compat rule. (Separate module so it is unit-testable without importing expo-sqlite.)
- `src/storage/db-name.test.ts` — unit tests for the filename rule.
- `src/wallet/pockets.ts` — pure Pockets-registry logic + `PocketInfo` type (add/rename/remove/list/normalize/next-index/guards). No expo/RN imports.
- `src/wallet/pockets.test.ts` — unit tests for the registry logic.
- `src/storage/pockets-store.ts` — persistence for the registry + active-pocket pointer, on top of `kv-store` (mirrors `secure-store.ts`).
- `src/wallet/move-address.ts` — pure `resolveMoveDestinationAddress` (derive a destination pocket's next receive address from the seed + account + next-unused index).
- `src/wallet/move-address.test.ts` — unit tests for destination-address derivation.
- `src/ui/sheets/PocketSwitcherSheet.tsx` — bottom-sheet body to switch the active pocket (modeled on `WalletSwitcherSheet.tsx`).
- `src/ui/sheets/MovePocketSheet.tsx` — bottom-sheet body to move funds between pockets.
- `app/pockets.tsx` — full Pockets management screen (list, create, rename, delete) (modeled on `app/wallets.tsx`).

**Modified:**
- `src/wallet/key-manager.ts` — thread an `account` parameter through `fromSeed`/`fromMnemonic`/`fromXpub`, the account-path derivation, and the per-address path string; add `getAccount()`. Default `0`.
- `src/wallet/key-manager.test.ts` — add account-index tests.
- `src/storage/database.ts` — `Database.open(walletId?, account = 0)` uses `databaseFileName`.
- `src/wallet/wallet-store.ts` — account-aware `initialize`; `activeAccount`/`pockets`/`pocketBalances` state; pocket actions (`loadPockets`/`switchPocket`/`createPocket`/`renamePocket`/`deletePocket`/`moveBetweenPockets`); clear pockets on wallet delete.
- `src/i18n/languages.ts` — `pockets.*` strings.
- `app/(tabs)/index.tsx` — a pocket pill in the home header that opens `PocketSwitcherSheet`.

---

## Task 1: Thread `account` through KeyManager

Make the BIP44 account index a first-class, defaulted parameter of key derivation. Everything else (pockets, per-account DBs, move) builds on this.

**Files:**
- Modify: `src/wallet/key-manager.ts` (constructor + fields ~`src/wallet/key-manager.ts:44-62`; `fromSeed` `:81-99`; `fromMnemonic` `:105-107`; `fromXpub` `:122-156`; `deriveAndStore` path string `:518`)
- Test: `src/wallet/key-manager.test.ts`

**Interfaces:**
- Consumes: `@scure/bip32` `HDKey`, `@fairco.in/core` `NetworkConfig`/`encodeAddress`/`getNetwork`/`deriveAddress`.
- Produces:
  - `KeyManager.fromSeed(seed: Uint8Array, network: NetworkConfig, account?: number): KeyManager` (default `account = 0`)
  - `KeyManager.fromMnemonic(mnemonic: string, network: NetworkConfig, account?: number): KeyManager`
  - `KeyManager.fromXpub(xpub: string, network: NetworkConfig, account?: number): KeyManager`
  - `KeyManager.prototype.getAccount(): number`
  - Unchanged: `DerivedAddress { address: string; path: string; index: number }`, `getNextAddress()`, `getNextChangeAddress()`, `accountXpub()`, `restoreCursors()`, `getPrivateKeyForAddress()`, `wipe()`.

- [ ] **Step 1: Write the failing tests**

Append to `src/wallet/key-manager.test.ts`:

```ts
// ---------------------------------------------------------------------------
// BIP44 account index (Pockets). Each account is an isolated subtree; account 0
// must remain byte-for-byte identical to the pre-Pockets single-account wallet.
// ---------------------------------------------------------------------------

import { deriveAddress } from "@fairco.in/core";

describe("KeyManager account index (Pockets)", () => {
  test("defaults to account 0 and reports it via getAccount()", () => {
    const km = KeyManager.fromMnemonic(MNEMONIC, MAINNET);
    expect(km.getAccount()).toBe(0);
  });

  test("account 0 addresses are unchanged (backward compatible)", () => {
    const seed = mnemonicToSeedSync(MNEMONIC);
    const withDefault = KeyManager.fromSeed(seed, MAINNET);
    const withExplicitZero = KeyManager.fromSeed(seed, MAINNET, 0);
    expect(withExplicitZero.getExternalAddresses()).toEqual(
      withDefault.getExternalAddresses(),
    );
  });

  test("account 1 derives a DIFFERENT external chain than account 0", () => {
    const seed = mnemonicToSeedSync(MNEMONIC);
    const acct0 = KeyManager.fromSeed(seed, MAINNET, 0);
    const acct1 = KeyManager.fromSeed(seed, MAINNET, 1);
    expect(acct1.getAccount()).toBe(1);
    expect(acct1.getExternalAddresses()[0]).not.toBe(
      acct0.getExternalAddresses()[0],
    );
  });

  test("account 1 addresses match @fairco.in/core deriveAddress(seed, 1, ...)", () => {
    const seed = mnemonicToSeedSync(MNEMONIC);
    const acct1 = KeyManager.fromSeed(seed, MAINNET, 1);
    const external = acct1.getExternalAddresses();
    for (let i = 0; i < 5; i++) {
      expect(external[i]).toBe(deriveAddress(seed, 1, 0, i, MAINNET).address);
    }
  });

  test("the per-address path string carries the account index", () => {
    const seed = mnemonicToSeedSync(MNEMONIC);
    const acct2 = KeyManager.fromSeed(seed, MAINNET, 2);
    const first = acct2.getNextAddress();
    expect(first.path).toBe(`m/44'/${MAINNET.bip44CoinType}'/2'/0/0`);
  });

  test("accountXpub differs per account and round-trips through fromXpub", () => {
    const seed = mnemonicToSeedSync(MNEMONIC);
    const acct0 = KeyManager.fromSeed(seed, MAINNET, 0);
    const acct1 = KeyManager.fromSeed(seed, MAINNET, 1);
    expect(acct1.accountXpub()).not.toBe(acct0.accountXpub());

    const watch1 = KeyManager.fromXpub(acct1.accountXpub(), MAINNET, 1);
    expect(watch1.getAccount()).toBe(1);
    expect(watch1.getExternalAddresses()).toEqual(acct1.getExternalAddresses());
    expect(watch1.getExternalAddresses()[0]).not.toBe(
      acct0.getExternalAddresses()[0],
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/FairCoinWorkspace/FAIRWallet && bun test src/wallet/key-manager.test.ts -t "account index"`
Expected: FAIL. `getAccount is not a function` and the account-1 assertions fail because `fromSeed` currently ignores the third argument and always derives `m/44'/coin'/0'` (so account-1 == account-0).

- [ ] **Step 3: Add the `account` field and getter to the class**

In `src/wallet/key-manager.ts`, add a field next to the other private readonly fields (after `private readonly network: NetworkConfig;`, around `:46`):

```ts
  private readonly account: number;
```

Replace the constructor (`:54-62`) with:

```ts
  private constructor(
    accountKey: HDKey,
    network: NetworkConfig,
    watchOnly: boolean,
    account: number,
  ) {
    this.accountKey = accountKey;
    this.network = network;
    this.watchOnly = watchOnly;
    this.account = account;
  }
```

Add a getter right after `isWatchOnly()` (after `:161`):

```ts
  /** The BIP44 account index (Pocket) this manager derives under. */
  getAccount(): number {
    return this.account;
  }
```

- [ ] **Step 4: Thread `account` through the factory methods and the path string**

Replace `fromSeed` (`:81-99`) with:

```ts
  static fromSeed(
    seed: Uint8Array,
    network: NetworkConfig,
    account = 0,
  ): KeyManager {
    const root = HDKey.fromMasterSeed(seed, {
      public: network.bip32.public,
      private: network.bip32.private,
    });
    const accountPath = `m/44'/${network.bip44CoinType}'/${account}'`;
    const accountKey = root.derive(accountPath);
    const manager = new KeyManager(accountKey, network, false, account);

    // Pre-generate initial batch of addresses up to the gap limit
    for (let i = 0; i < EXTERNAL_GAP_LIMIT; i++) {
      manager.deriveExternal(i);
    }
    for (let i = 0; i < CHANGE_GAP_LIMIT; i++) {
      manager.deriveChange(i);
    }

    return manager;
  }
```

Replace `fromMnemonic` (`:105-107`) with:

```ts
  static fromMnemonic(
    mnemonic: string,
    network: NetworkConfig,
    account = 0,
  ): KeyManager {
    return KeyManager.fromSeed(KeyManager.deriveSeed(mnemonic), network, account);
  }
```

In `fromXpub`, change the signature (`:122`) to accept `account = 0`:

```ts
  static fromXpub(xpub: string, network: NetworkConfig, account = 0): KeyManager {
```

and change the `new KeyManager(...)` call inside `fromXpub` (`:146`) to pass the account:

```ts
    const manager = new KeyManager(accountKey, network, true, account);
```

Finally, in `deriveAndStore`, replace the hardcoded path string (`:518`):

```ts
    const path = `m/44'/${this.network.bip44CoinType}'/${this.account}'/${chain}/${index}`;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ~/FairCoinWorkspace/FAIRWallet && bun test src/wallet/key-manager.test.ts`
Expected: PASS (new account tests AND all pre-existing cursor/xpub/wipe tests — the account-0 defaults keep them green).

- [ ] **Step 6: Typecheck**

Run: `cd ~/FairCoinWorkspace/FAIRWallet && bun run typecheck`
Expected: no errors. (`wallet-store.ts` still calls `fromSeed`/`fromXpub` with 2 args → account defaults to 0.)

- [ ] **Step 7: Commit**

```bash
cd ~/FairCoinWorkspace/FAIRWallet
git add src/wallet/key-manager.ts src/wallet/key-manager.test.ts
git commit -m "feat(wallet): thread BIP44 account index through KeyManager (Pockets)"
```

---

## Task 2: Account-aware database filename + wallet-store init

Give each pocket its own SQLite file and teach `initialize` to open the right file and build the KeyManager for the right account, restoring the persisted active pocket on boot/unlock.

**Files:**
- Create: `src/storage/db-name.ts`
- Test: `src/storage/db-name.test.ts`
- Modify: `src/storage/database.ts` (`Database.open` `:259-267`)
- Create (persistence needed by `initialize`): `src/storage/pockets-store.ts` (only `getActivePocket`/`setActivePocket` are needed this task; the registry functions are added in Task 3 — create the file now with all of them to avoid a second edit)
- Modify: `src/wallet/wallet-store.ts` (`initialize` `:959-1105`; `WalletState` `:170-174` and `:109-157`; `DEFAULT_WALLET_STATE` `:841`; store initial state `:919`)

**Interfaces:**
- Consumes: `KeyManager.fromSeed(seed, network, account)` (Task 1).
- Produces:
  - `databaseFileName(walletId?: string, account?: number): string`
  - `Database.open(walletId?: string, account?: number): Promise<Database>`
  - `getActivePocket(walletId: string): Promise<number>`; `setActivePocket(walletId: string, account: number): Promise<void>`
  - `WalletState.activeAccount: number` (Zustand state; the active pocket)
  - `initialize(mnemonic: string, walletId?: string, onReady?: () => void, account?: number): Promise<void>` — when `account` is omitted it resolves the persisted active pocket for the wallet.

- [ ] **Step 1: Write the failing test for the filename rule**

Create `src/storage/db-name.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { databaseFileName } from "./db-name";

describe("databaseFileName", () => {
  test("no walletId, account 0 → legacy default name", () => {
    expect(databaseFileName()).toBe("fairwallet.db");
    expect(databaseFileName(undefined, 0)).toBe("fairwallet.db");
  });

  test("walletId, account 0 → legacy per-wallet name (backward compatible)", () => {
    expect(databaseFileName("abc", 0)).toBe("fairwallet_abc.db");
  });

  test("walletId, account > 0 → suffixed per-pocket name", () => {
    expect(databaseFileName("abc", 1)).toBe("fairwallet_abc_acct1.db");
    expect(databaseFileName("abc", 7)).toBe("fairwallet_abc_acct7.db");
  });

  test("no walletId, account > 0 → suffixed default name", () => {
    expect(databaseFileName(undefined, 2)).toBe("fairwallet_acct2.db");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/FairCoinWorkspace/FAIRWallet && bun test src/storage/db-name.test.ts`
Expected: FAIL — `Cannot find module './db-name'`.

- [ ] **Step 3: Implement the filename helper**

Create `src/storage/db-name.ts`:

```ts
/**
 * SQLite filename for a wallet + Pocket (BIP44 account index).
 *
 * Kept in its own module (no expo-sqlite import) so it is unit-testable and so
 * the account-0 backward-compat rule lives in exactly one place:
 *   - account 0 keeps the pre-Pockets filename, so existing installs keep using
 *     their existing database untouched;
 *   - account > 0 gets an `_acct<n>` suffix, giving each Pocket a fully isolated
 *     UTXO set / cursor space / history.
 */

const DEFAULT_DATABASE_NAME = "fairwallet.db";

export function databaseFileName(walletId?: string, account = 0): string {
  if (!walletId) {
    return account === 0 ? DEFAULT_DATABASE_NAME : `fairwallet_acct${account}.db`;
  }
  return account === 0
    ? `fairwallet_${walletId}.db`
    : `fairwallet_${walletId}_acct${account}.db`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/FairCoinWorkspace/FAIRWallet && bun test src/storage/db-name.test.ts`
Expected: PASS.

- [ ] **Step 5: Use the helper in `Database.open`**

In `src/storage/database.ts`, add the import near the top (with the other imports):

```ts
import { databaseFileName } from "./db-name";
```

Replace `Database.open` (`:259-267`) with:

```ts
  /**
   * Open a database for a wallet + Pocket. `account` (BIP44 account index)
   * partitions each Pocket into its own file; account 0 keeps the legacy name.
   */
  static async open(walletId?: string, account = 0): Promise<Database> {
    const dbName = databaseFileName(walletId, account);
    const db = await SQLite.openDatabaseAsync(dbName);
    const instance = new Database(db);
    await instance.initialize();
    return instance;
  }
```

- [ ] **Step 6: Create the pockets-store persistence module**

Create `src/storage/pockets-store.ts` (the registry functions here are exercised in Task 3; `getActivePocket`/`setActivePocket` are used by `initialize` in this task):

```ts
/**
 * Persistence for Pockets (BIP44 sub-accounts of one wallet).
 *
 * Mirrors the multi-wallet index in `secure-store.ts`: a JSON registry stored
 * per wallet in the key-value store, plus a per-wallet pointer to the active
 * Pocket. A wallet with no stored registry is treated as a single implicit
 * "main" Pocket at account 0, so pre-Pockets wallets need no migration.
 */

import { getItemAsync, setItemAsync, deleteItemAsync } from "./kv-store";
import {
  type PocketInfo,
  MAIN_POCKET_ACCOUNT,
  normalizePockets,
} from "../wallet/pockets";

const POCKETS_PREFIX = "fairwallet_pockets_";
const ACTIVE_POCKET_PREFIX = "fairwallet_active_pocket_";

/** The Pocket registry for a wallet (always contains the main Pocket). */
export async function getPockets(walletId: string): Promise<PocketInfo[]> {
  const raw = await getItemAsync(`${POCKETS_PREFIX}${walletId}`);
  if (!raw) return normalizePockets([]);
  try {
    return normalizePockets(JSON.parse(raw) as PocketInfo[]);
  } catch {
    // Corrupted registry JSON — fall back to the implicit main Pocket rather
    // than throwing, so a bad write never bricks wallet init.
    return normalizePockets([]);
  }
}

/** Persist the Pocket registry for a wallet. */
export async function savePockets(
  walletId: string,
  pockets: PocketInfo[],
): Promise<void> {
  await setItemAsync(
    `${POCKETS_PREFIX}${walletId}`,
    JSON.stringify(normalizePockets(pockets)),
  );
}

/** The active Pocket (BIP44 account index) for a wallet; defaults to main (0). */
export async function getActivePocket(walletId: string): Promise<number> {
  const raw = await getItemAsync(`${ACTIVE_POCKET_PREFIX}${walletId}`);
  if (!raw) return MAIN_POCKET_ACCOUNT;
  const account = Number.parseInt(raw, 10);
  return Number.isInteger(account) && account >= 0 ? account : MAIN_POCKET_ACCOUNT;
}

/** Set the active Pocket for a wallet. */
export async function setActivePocket(
  walletId: string,
  account: number,
): Promise<void> {
  await setItemAsync(`${ACTIVE_POCKET_PREFIX}${walletId}`, String(account));
}

/** Remove all Pocket data for a wallet (call when the wallet is deleted). */
export async function clearPockets(walletId: string): Promise<void> {
  await deleteItemAsync(`${POCKETS_PREFIX}${walletId}`);
  await deleteItemAsync(`${ACTIVE_POCKET_PREFIX}${walletId}`);
}
```

> This imports `../wallet/pockets` (created in Task 3). If you are executing strictly task-by-task, create the minimal `src/wallet/pockets.ts` from Task 3 Step 3 now (it is pure and has no back-dependency), then finish Task 3's tests afterwards. The subagent-driven flow will normally have Task 3 land right after this task.

- [ ] **Step 7: Make `initialize` account-aware**

In `src/wallet/wallet-store.ts`, add imports (with the other `../storage` imports):

```ts
import { getActivePocket, setActivePocket } from "../storage/pockets-store";
```

Add `activeAccount` to `WalletState` — in the `// Multi-wallet` block (after `hasBackedUp: boolean;`, `:122`):

```ts
  /** Active Pocket (BIP44 account index) within the current wallet. */
  activeAccount: number;
```

Change the `initialize` signature in `WalletState` (`:170-174`) to add the optional `account`:

```ts
  initialize: (
    mnemonic: string,
    walletId?: string,
    onReady?: () => void,
    account?: number,
  ) => Promise<void>;
```

Add `activeAccount: 0` to `DEFAULT_WALLET_STATE` (`:841`, after `hasBackedUp: false,`):

```ts
  activeAccount: 0,
```

Add `activeAccount: 0` to the store's initial-state object (the `create<WalletState>` literal, next to `activeWalletId: null,` at `:927`):

```ts
  activeAccount: 0,
```

Now change the `initialize` implementation. Its parameter list (`:958-962`) becomes:

```ts
  initialize: async (
    mnemonic: string,
    walletId?: string,
    onReady?: () => void,
    account?: number,
  ): Promise<void> => {
```

Replace the DB-open + KeyManager-build region (`:984-1005`) with the account-aware version:

```ts
      networkConfig = getNetwork(state.network);

      // Resolve the wallet + active Pocket once, up front. When `account` is
      // omitted (boot / unlock / wallet switch) restore the persisted active
      // Pocket; explicit callers (switchPocket) pass it. Account 0 keeps the
      // legacy DB file, so pre-Pockets wallets open exactly where they always did.
      const activeId = walletId ?? (await getActiveWalletId());
      const resolvedAccount =
        account ?? (activeId ? await getActivePocket(activeId) : 0);

      database = await Database.open(activeId ?? undefined, resolvedAccount);
      // A wallet's stored secret is either a BIP39 mnemonic or the watch-only
      // marker `xpub:<extended public key>`. The marker MUST route to the
      // public-only KeyManager: feeding it into mnemonicToSeedSync would
      // silently derive a random spendable keypair (BIP39 doesn't validate),
      // producing a dangerous fake wallet (review finding C2). Watch-only
      // wallets have no Pockets, so they always open at account 0.
      if (mnemonic.startsWith(XPUB_MARKER_PREFIX)) {
        const xpub = mnemonic.slice(XPUB_MARKER_PREFIX.length);
        keyManager = KeyManager.fromXpub(xpub, networkConfig);
      } else {
        // Reuse the cached BIP39 seed when present so unlock skips the
        // multi-second PBKDF2 mnemonic→seed derivation; derive + cache it on the
        // first run. The seed is shared by every Pocket of this wallet, so it is
        // keyed by the wallet identity, and the account selects the subtree.
        const seedCacheId = activeId ?? "default";
        let seed = await getCachedWalletSeed(seedCacheId);
        if (!seed) {
          seed = KeyManager.deriveSeed(mnemonic);
          await cacheWalletSeed(seedCacheId, seed);
        }
        keyManager = KeyManager.fromSeed(seed, networkConfig, resolvedAccount);
      }
```

Because `activeId` is now computed at the top, DELETE the later re-declaration at `:1043` (`const activeId = walletId ?? await getActiveWalletId();`) so the value computed above is reused for the wallet-info lookup below it.

In the big `set({ ... })` that publishes hydrated state (`:1091`), add `activeAccount`:

```ts
        activeAccount: resolvedAccount,
```

(Insert it alongside `initialized: true,` inside that object.)

- [ ] **Step 8: Typecheck**

Run: `cd ~/FairCoinWorkspace/FAIRWallet && bun run typecheck`
Expected: no errors.

- [ ] **Step 9: Run the wallet-core test suite (regression)**

Run: `cd ~/FairCoinWorkspace/FAIRWallet && bun test src`
Expected: PASS (no wallet-store test exists — this confirms the pure suites, incl. Task 1/Task 2 unit tests, stay green).

- [ ] **Step 10: Native smoke — existing wallet still opens (foregrounded)**

Run the app on an emulator/device with an EXISTING wallet (`bun run start` → open on device). Confirm the wallet opens, shows the same balance/address/history as before, and `Database.open` used `fairwallet_<id>.db` (account 0). This proves backward compatibility of the DB filename + init path.
Expected: home renders identically to pre-change; no new DB file created for the existing wallet.

- [ ] **Step 11: Commit**

```bash
cd ~/FairCoinWorkspace/FAIRWallet
git add src/storage/db-name.ts src/storage/db-name.test.ts src/storage/database.ts src/storage/pockets-store.ts src/wallet/wallet-store.ts
git commit -m "feat(wallet): account-aware DB filename + Pocket-aware initialize"
```

---

## Task 3: Pockets data model (registry + store actions)

Model the set of Pockets and the ability to create/rename/delete/switch them. Pure logic is unit-tested; persistence + store wiring is typechecked and device-verified.

**Files:**
- Create: `src/wallet/pockets.ts`
- Test: `src/wallet/pockets.test.ts`
- (Already created in Task 2) `src/storage/pockets-store.ts`
- Modify: `src/wallet/wallet-store.ts` (add state + actions; `deleteWallet` clears pockets)

**Interfaces:**
- Consumes: `getPockets`/`savePockets`/`getActivePocket`/`setActivePocket`/`clearPockets` (Task 2); `initialize(..., account)`, `Database.open(walletId, account)`.
- Produces:
  - `PocketInfo { account: number; name: string; createdAt: number }`
  - `MAIN_POCKET_ACCOUNT = 0`
  - `normalizePockets(list: PocketInfo[]): PocketInfo[]` — always returns a list containing the main Pocket (account 0), sorted by account ascending, deduped by account.
  - `nextAccountIndex(list: PocketInfo[]): number` — `max(account) + 1`.
  - `addPocket(list: PocketInfo[], name: string, now: number): PocketInfo[]`
  - `renamePocket(list: PocketInfo[], account: number, name: string): PocketInfo[]`
  - `removePocket(list: PocketInfo[], account: number): PocketInfo[]`
  - `canDeletePocket(list: PocketInfo[], account: number): boolean` — true iff account ≠ 0 and it exists.
  - `findPocket(list: PocketInfo[], account: number): PocketInfo | undefined`
  - Store: `pockets: PocketInfo[]`, `pocketBalances: Record<number, bigint>`, `loadPockets()`, `switchPocket(account)`, `createPocket(name): Promise<number>`, `renamePocket(account, name)`, `deletePocket(account)`.

- [ ] **Step 1: Write the failing tests for the pure registry**

Create `src/wallet/pockets.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import {
  MAIN_POCKET_ACCOUNT,
  normalizePockets,
  nextAccountIndex,
  addPocket,
  renamePocket,
  removePocket,
  canDeletePocket,
  findPocket,
  type PocketInfo,
} from "./pockets";

const main: PocketInfo = { account: 0, name: "Main", createdAt: 1 };

describe("Pockets registry (pure)", () => {
  test("normalizePockets always includes the main Pocket", () => {
    expect(normalizePockets([])).toEqual([
      { account: MAIN_POCKET_ACCOUNT, name: "Main", createdAt: 0 },
    ]);
  });

  test("normalizePockets sorts by account and dedupes", () => {
    const out = normalizePockets([
      { account: 2, name: "B", createdAt: 3 },
      { account: 0, name: "Main", createdAt: 1 },
      { account: 2, name: "dupe", createdAt: 9 },
    ]);
    expect(out.map((p) => p.account)).toEqual([0, 2]);
    expect(findPocket(out, 2)?.name).toBe("B"); // first wins
  });

  test("nextAccountIndex is max(account) + 1", () => {
    expect(nextAccountIndex([main])).toBe(1);
    expect(
      nextAccountIndex([main, { account: 5, name: "X", createdAt: 2 }]),
    ).toBe(6);
  });

  test("addPocket appends at the next account index", () => {
    const out = addPocket([main], "Savings", 100);
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ account: 1, name: "Savings", createdAt: 100 });
  });

  test("renamePocket updates only the target", () => {
    const list = addPocket([main], "Savings", 100);
    const out = renamePocket(list, 1, "Rent");
    expect(findPocket(out, 1)?.name).toBe("Rent");
    expect(findPocket(out, 0)?.name).toBe("Main");
  });

  test("removePocket drops the target but keeps the main Pocket", () => {
    const list = addPocket([main], "Savings", 100);
    expect(removePocket(list, 1).map((p) => p.account)).toEqual([0]);
    expect(removePocket(list, 0).map((p) => p.account)).toEqual([0, 1]); // main is protected
  });

  test("canDeletePocket refuses the main Pocket and unknown accounts", () => {
    const list = addPocket([main], "Savings", 100);
    expect(canDeletePocket(list, 0)).toBe(false);
    expect(canDeletePocket(list, 1)).toBe(true);
    expect(canDeletePocket(list, 9)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/FairCoinWorkspace/FAIRWallet && bun test src/wallet/pockets.test.ts`
Expected: FAIL — `Cannot find module './pockets'`.

- [ ] **Step 3: Implement the pure registry**

Create `src/wallet/pockets.ts`:

```ts
/**
 * Pure Pockets-registry logic. A Pocket is a BIP44 account index inside one
 * wallet's seed (`m/44'/coin'/account'`). This module has NO expo/RN imports so
 * it is fully unit-testable; persistence lives in `../storage/pockets-store.ts`.
 */

export interface PocketInfo {
  /** BIP44 account index. 0 is the main Pocket and can never be deleted. */
  account: number;
  name: string;
  createdAt: number;
}

export const MAIN_POCKET_ACCOUNT = 0;

/**
 * Return a valid registry: exactly one entry per account, sorted ascending,
 * always containing the main Pocket (account 0). Duplicate accounts keep the
 * first occurrence. Used on every read and write so callers never see a
 * malformed list.
 */
export function normalizePockets(list: PocketInfo[]): PocketInfo[] {
  const byAccount = new Map<number, PocketInfo>();
  for (const pocket of list) {
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

export function findPocket(
  list: PocketInfo[],
  account: number,
): PocketInfo | undefined {
  return list.find((p) => p.account === account);
}

export function addPocket(
  list: PocketInfo[],
  name: string,
  now: number,
): PocketInfo[] {
  const account = nextAccountIndex(list);
  return normalizePockets([...list, { account, name, createdAt: now }]);
}

export function renamePocket(
  list: PocketInfo[],
  account: number,
  name: string,
): PocketInfo[] {
  return normalizePockets(
    list.map((p) => (p.account === account ? { ...p, name } : p)),
  );
}

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/FairCoinWorkspace/FAIRWallet && bun test src/wallet/pockets.test.ts`
Expected: PASS.

- [ ] **Step 5: Add Pocket state + actions to the store**

In `src/wallet/wallet-store.ts`, add imports:

```ts
import {
  type PocketInfo,
  MAIN_POCKET_ACCOUNT,
  addPocket,
  renamePocket as renamePocketList,
  removePocket as removePocketList,
  canDeletePocket,
} from "./pockets";
import {
  getPockets,
  savePockets,
  setActivePocket,
  clearPockets,
} from "../storage/pockets-store";
```

> `getActivePocket`/`setActivePocket` may already be imported from Task 2; keep a single import statement — add `getPockets`, `savePockets`, `clearPockets` to it rather than duplicating.

Add state fields to `WalletState` (after the `activeAccount` line from Task 2):

```ts
  /** Pockets (BIP44 sub-accounts) of the current wallet. */
  pockets: PocketInfo[];
  /** Per-Pocket balance (account index → confirmed+unconfirmed sats). */
  pocketBalances: Record<number, bigint>;
```

Add action signatures to `WalletState` (in the `// Multi-wallet actions` block):

```ts
  // Pockets
  loadPockets: () => Promise<void>;
  switchPocket: (account: number) => Promise<void>;
  createPocket: (name: string) => Promise<number>;
  renamePocket: (account: number, name: string) => Promise<void>;
  deletePocket: (account: number) => Promise<void>;
```

Add the defaults to `DEFAULT_WALLET_STATE` (after `activeAccount: 0,`):

```ts
  pockets: [] as PocketInfo[],
  pocketBalances: {} as Record<number, bigint>,
```

Add the same two to the store's initial-state object (next to the `activeAccount: 0,` you added there).

Add a module-level helper next to the other internal helpers (e.g. after `getActiveWalletAddresses`, ~`:355`):

```ts
/**
 * Sum the confirmed+unconfirmed unspent value persisted for a Pocket by reading
 * its isolated database directly. Used to show balances for Pockets that are not
 * the active one (their UTXO set is not loaded into memory). Opens read-only and
 * always closes.
 */
async function readPocketUnspentTotal(
  walletId: string,
  account: number,
): Promise<bigint> {
  const db = await Database.open(walletId, account);
  try {
    const rows = await db.getUnspentUTXOs();
    return rows.reduce((sum, row) => sum + BigInt(row.value), 0n);
  } finally {
    await db.close();
  }
}
```

Add the actions inside the `create<WalletState>((set, get) => ({ ... }))` object (place them next to `switchWallet`):

```ts
  loadPockets: async (): Promise<void> => {
    const walletId = get().activeWalletId;
    if (!walletId) return;
    const list = await getPockets(walletId);
    const activeAccount = get().activeAccount;
    const balances: Record<number, bigint> = {};
    for (const pocket of list) {
      balances[pocket.account] =
        pocket.account === activeAccount
          ? get().balance
          : await readPocketUnspentTotal(walletId, pocket.account);
    }
    set({ pockets: list, pocketBalances: balances });
  },

  switchPocket: async (account: number): Promise<void> => {
    const state = get();
    if (state.activeAccount === account) return;
    const walletId = state.activeWalletId;
    if (!walletId) return;

    // Serialise the whole switch, exactly like switchWallet: tear the current
    // Pocket down (close its DB, wipe the KeyManager, clear intervals) and
    // re-init the module globals for the new account.
    return queueWalletInit(async () => {
      set({ loading: true, error: null });
      try {
        if (database) {
          await database.close();
        }
        resetWalletInternals();
        set({
          ...DEFAULT_WALLET_STATE,
          network: state.network,
          activeWalletId: walletId,
          activeWalletName: state.activeWalletName,
          wallets: state.wallets,
          pockets: state.pockets,
          activeAccount: account,
          loading: true,
        });
        await setActivePocket(walletId, account);
        const mnemonic = await getWalletMnemonic(walletId);
        if (!mnemonic) {
          throw new Error("Wallet mnemonic not found");
        }
        await get().initialize(mnemonic, walletId, undefined, account);
        await get().loadPockets();
      } catch (err: unknown) {
        set({
          loading: false,
          error: err instanceof Error ? err.message : "Failed to switch pocket",
        });
      }
    });
  },

  createPocket: async (name: string): Promise<number> => {
    const walletId = get().activeWalletId;
    if (!walletId) {
      throw new Error("No active wallet");
    }
    const list = await getPockets(walletId);
    const updated = addPocket(list, name.trim(), Date.now());
    await savePockets(walletId, updated);
    await get().loadPockets();
    return updated[updated.length - 1].account;
  },

  renamePocket: async (account: number, name: string): Promise<void> => {
    const walletId = get().activeWalletId;
    if (!walletId) return;
    const list = await getPockets(walletId);
    await savePockets(walletId, renamePocketList(list, account, name.trim()));
    if (account === get().activeAccount) {
      set({ activeWalletName: name.trim() });
    }
    await get().loadPockets();
  },

  deletePocket: async (account: number): Promise<void> => {
    const walletId = get().activeWalletId;
    if (!walletId) return;
    const list = await getPockets(walletId);
    if (!canDeletePocket(list, account)) {
      throw new Error("This pocket cannot be deleted");
    }
    const total = await readPocketUnspentTotal(walletId, account);
    if (total > 0n) {
      throw new Error("Move funds out of this pocket before deleting it");
    }
    await savePockets(walletId, removePocketList(list, account));
    if (get().activeAccount === account) {
      await get().switchPocket(MAIN_POCKET_ACCOUNT);
    } else {
      await get().loadPockets();
    }
  },
```

- [ ] **Step 6: Clear Pockets when a wallet is deleted**

In the existing `deleteWallet` action, after the wallet's mnemonic/seed/DB are removed, add:

```ts
      await clearPockets(walletId);
```

(Place it next to the other per-wallet cleanup calls inside `deleteWallet`.)

- [ ] **Step 7: Typecheck + pure suite**

Run: `cd ~/FairCoinWorkspace/FAIRWallet && bun run typecheck && bun test src`
Expected: no type errors; all pure tests pass.

- [ ] **Step 8: Native verify — create + switch (foregrounded, testnet)**

On an emulator/device (testnet), from the UI you will wire in Task 5 — or temporarily by calling the actions from a dev button — verify: `createPocket("Savings")` returns account 1 and creates `fairwallet_<id>_acct1.db`; `switchPocket(1)` hydrates an EMPTY balance and a fresh receive address distinct from the main Pocket; `switchPocket(0)` returns to the main Pocket's original balance/address; `deletePocket(1)` succeeds only while empty.
Expected: isolated balances/addresses per Pocket; main Pocket unchanged throughout.

- [ ] **Step 9: Commit**

```bash
cd ~/FairCoinWorkspace/FAIRWallet
git add src/wallet/pockets.ts src/wallet/pockets.test.ts src/wallet/wallet-store.ts
git commit -m "feat(wallet): Pockets registry + create/switch/rename/delete store actions"
```

---

## Task 4: Move funds between Pockets (on-chain self-transfer)

Moving between Pockets is a normal send from the active Pocket to the destination Pocket's next receive address. The security-relevant part — deriving the correct destination address in the destination subtree — is pure and unit-tested; the wiring reuses the existing `sendTransaction`.

**Files:**
- Create: `src/wallet/move-address.ts`
- Test: `src/wallet/move-address.test.ts`
- Modify: `src/wallet/wallet-store.ts` (add `moveBetweenPockets`)

**Interfaces:**
- Consumes: `KeyManager.fromSeed(seed, network, account)` + `restoreCursors` + `getNextAddress` (Task 1); `Database.open(walletId, account)` + `getNextUnusedIndex(false)` + `insertAddress` (Task 2); `sendTransaction(toAddress, amount, feeRate)` (existing); `getCachedWalletSeed`/`cacheWalletSeed`/`getWalletMnemonic` (existing).
- Produces:
  - `resolveMoveDestinationAddress(seed: Uint8Array, network: NetworkConfig, account: number, nextUnusedIndex: number): DerivedAddress` — the destination Pocket's next external address at `nextUnusedIndex`.
  - Store: `moveBetweenPockets(toAccount: number, amount: bigint, feeRate: number): Promise<string>` (returns the broadcast txid).

- [ ] **Step 1: Write the failing test for destination-address derivation**

Create `src/wallet/move-address.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { getNetwork, deriveAddress } from "@fairco.in/core";
import { mnemonicToSeedSync } from "@scure/bip39";
import { KeyManager } from "./key-manager";
import { resolveMoveDestinationAddress } from "./move-address";

const MAINNET = getNetwork("mainnet");
const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("resolveMoveDestinationAddress", () => {
  test("derives the destination account's external address at the given index", () => {
    const seed = mnemonicToSeedSync(MNEMONIC);
    const dest = resolveMoveDestinationAddress(seed, MAINNET, 1, 0);
    expect(dest.index).toBe(0);
    expect(dest.path).toBe(`m/44'/${MAINNET.bip44CoinType}'/1'/0/0`);
    expect(dest.address).toBe(deriveAddress(seed, 1, 0, 0, MAINNET).address);
  });

  test("respects a non-zero next-unused index", () => {
    const seed = mnemonicToSeedSync(MNEMONIC);
    const dest = resolveMoveDestinationAddress(seed, MAINNET, 2, 3);
    expect(dest.index).toBe(3);
    expect(dest.address).toBe(deriveAddress(seed, 2, 0, 3, MAINNET).address);
  });

  test("destination address belongs to the destination Pocket, not the source", () => {
    const seed = mnemonicToSeedSync(MNEMONIC);
    const source = KeyManager.fromSeed(seed, MAINNET, 0);
    const dest = resolveMoveDestinationAddress(seed, MAINNET, 1, 0);
    expect(source.ownsAddress(dest.address)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/FairCoinWorkspace/FAIRWallet && bun test src/wallet/move-address.test.ts`
Expected: FAIL — `Cannot find module './move-address'`.

- [ ] **Step 3: Implement `resolveMoveDestinationAddress`**

Create `src/wallet/move-address.ts`:

```ts
/**
 * Derive the next receive address of a destination Pocket (BIP44 account) so a
 * Pocket-to-Pocket move can send to it. Pure: builds a KeyManager for the
 * destination account from the shared seed, advances it to the destination's
 * next-unused external index, and returns that address. The move itself is an
 * ordinary on-chain self-transfer handled by `wallet-store.sendTransaction`.
 */

import type { NetworkConfig } from "@fairco.in/core";
import { KeyManager, type DerivedAddress } from "./key-manager";

export function resolveMoveDestinationAddress(
  seed: Uint8Array,
  network: NetworkConfig,
  account: number,
  nextUnusedIndex: number,
): DerivedAddress {
  const manager = KeyManager.fromSeed(seed, network, account);
  // Advance the external cursor to the destination Pocket's next unused index so
  // getNextAddress() returns exactly that address (and pre-derives the lookahead
  // window for the destination's Bloom filter after it syncs).
  manager.restoreCursors(nextUnusedIndex, 0);
  return manager.getNextAddress();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/FairCoinWorkspace/FAIRWallet && bun test src/wallet/move-address.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the `moveBetweenPockets` store action**

In `src/wallet/wallet-store.ts`, add the import:

```ts
import { resolveMoveDestinationAddress } from "./move-address";
```

Add `moveBetweenPockets` to the `WalletState` `// Pockets` action block:

```ts
  moveBetweenPockets: (
    toAccount: number,
    amount: bigint,
    feeRate: number,
  ) => Promise<string>;
```

Add the implementation next to the other Pocket actions in the store object:

```ts
  moveBetweenPockets: async (
    toAccount: number,
    amount: bigint,
    feeRate: number,
  ): Promise<string> => {
    const state = get();
    const walletId = state.activeWalletId;
    if (!walletId) {
      throw new Error("No active wallet");
    }
    if (state.isWatchOnly) {
      throw new Error("Watch-only wallets cannot move funds");
    }
    if (toAccount === state.activeAccount) {
      throw new Error("Choose a different destination pocket");
    }
    if (!networkConfig) {
      throw new Error("Wallet not initialized");
    }

    // The shared seed is cached during initialize; fall back to deriving it from
    // the mnemonic if the cache was cleared. Watch-only wallets have no seed.
    let seed = await getCachedWalletSeed(walletId);
    if (!seed) {
      const mnemonic = await getWalletMnemonic(walletId);
      if (!mnemonic || mnemonic.startsWith(XPUB_MARKER_PREFIX)) {
        throw new Error("Wallet seed unavailable");
      }
      seed = KeyManager.deriveSeed(mnemonic);
      await cacheWalletSeed(walletId, seed);
    }

    // Resolve + persist the destination Pocket's next receive address in ITS own
    // isolated database so that Pocket watches it once it next syncs.
    const destDb = await Database.open(walletId, toAccount);
    let destAddress: string;
    try {
      const nextIndex = await destDb.getNextUnusedIndex(false);
      const dest = resolveMoveDestinationAddress(
        seed,
        networkConfig,
        toAccount,
        nextIndex,
      );
      await destDb.insertAddress(dest.address, dest.path, dest.index, false);
      destAddress = dest.address;
    } finally {
      await destDb.close();
    }

    // Reuse the existing send path: an ordinary on-chain self-transfer spending
    // from the active (source) Pocket to the destination Pocket's address.
    const txid = await get().sendTransaction(destAddress, amount, feeRate);
    await get().loadPockets();
    return txid;
  },
```

- [ ] **Step 6: Typecheck + full pure suite**

Run: `cd ~/FairCoinWorkspace/FAIRWallet && bun run typecheck && bun test src`
Expected: no type errors; all pure tests pass.

- [ ] **Step 7: Native verify — real move on testnet (foregrounded)**

On testnet with funds in the main Pocket: create "Savings" (account 1), move a small amount main → Savings. Confirm: a real tx is broadcast (txid returned), the main Pocket balance drops by amount+fee, and after the destination Pocket syncs its balance rises by the moved amount at the address you persisted. Verify the tx on the FairCoin testnet explorer.
Expected: on-chain self-transfer succeeds; funds land in the destination Pocket's subtree.

- [ ] **Step 8: Commit**

```bash
cd ~/FairCoinWorkspace/FAIRWallet
git add src/wallet/move-address.ts src/wallet/move-address.test.ts src/wallet/wallet-store.ts
git commit -m "feat(wallet): move funds between Pockets via on-chain self-transfer"
```

---

## Task 5: Pockets UI

Surface Pockets in the app: a switcher sheet, a management screen, and a move sheet — modeled directly on the existing `WalletSwitcherSheet`, `app/wallets.tsx`, and the Bloom `Dialog` patterns.

**Files:**
- Create: `src/ui/sheets/PocketSwitcherSheet.tsx`
- Create: `src/ui/sheets/MovePocketSheet.tsx`
- Create: `app/pockets.tsx`
- Modify: `src/i18n/languages.ts` (add `pockets.*` keys)
- Modify: `app/(tabs)/index.tsx` (mount the switcher from a header pill)

**Interfaces:**
- Consumes: `useWalletStore` selectors `pockets`, `activeAccount`, `pocketBalances`, `balance`, and actions `loadPockets`, `switchPocket`, `createPocket`, `renamePocket`, `deletePocket`, `moveBetweenPockets`, `estimateFee`; `FEE_RATES`; Bloom `Dialog`/`useDialogControl`/`useTheme`; `ListItem`/`Button`/`Badge`/`EmptyState`/`ScreenHeader`/`AmountInput`; `t` from `../i18n`.
- Produces: `PocketSwitcherSheet({ onDone })`, `MovePocketSheet({ onDone })`, default-exported `PocketsScreen` at route `/pockets`.

- [ ] **Step 1: Add i18n strings**

In `src/i18n/languages.ts`, find the existing `wallets` block and add a sibling `pockets` block to the English catalog (and mirror the SAME keys into every other locale catalog in the file — English text is acceptable until localized, but the keys must exist everywhere to keep `t()` type-safe):

```
pockets.title = "Pockets"
pockets.subtitle.one = "{{count}} pocket"
pockets.subtitle.other = "{{count}} pockets"
pockets.active = "Active"
pockets.mainName = "Main"
pockets.switcherTitle = "Switch pocket"
pockets.manage = "Manage pockets"
pockets.createCta = "New pocket"
pockets.create.title = "New pocket"
pockets.create.nameLabel = "POCKET NAME"
pockets.create.namePlaceholder = "e.g. Savings"
pockets.create.cta = "Create pocket"
pockets.create.error.nameRequired = "Enter a name for the pocket"
pockets.create.error.failed = "Could not create the pocket"
pockets.rename.title = "Rename pocket"
pockets.rename.cta = "Save"
pockets.delete.title = "Delete pocket?"
pockets.delete.description = "Remove \"{{name}}\" from your pockets?"
pockets.delete.notEmpty = "Move funds out of this pocket before deleting it."
pockets.delete.cannotMain = "The main pocket cannot be deleted."
pockets.move.title = "Move between pockets"
pockets.move.to = "TO POCKET"
pockets.move.amountLabel = "AMOUNT"
pockets.move.cta = "Move"
pockets.move.sameAccount = "Choose a different destination pocket."
pockets.move.failed = "Could not move funds"
```

> Follow the exact object/nesting shape the file already uses for `wallets.*` (dotted vs nested). If the file nests (`wallets: { title, ... }`), nest `pockets: { ... }` the same way.

- [ ] **Step 2: Implement `PocketSwitcherSheet`**

Create `src/ui/sheets/PocketSwitcherSheet.tsx`:

```tsx
/**
 * Pocket switcher sheet content. Content-only body (no wrapper / safe-area /
 * scroll of its own) for a Bloom bottom-sheet `<Dialog placement="bottom">`,
 * modeled on WalletSwitcherSheet. Tapping a non-active Pocket switches to it and
 * closes; the active one just closes. A "Manage pockets" row opens app/pockets.
 */

import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useTheme } from "@oxyhq/bloom/theme";
import { useWalletStore } from "../../wallet/wallet-store";
import { MAIN_POCKET_ACCOUNT } from "../../wallet/pockets";
import { ListItem, AmountText } from "../components";
import { t } from "../../i18n";

const CONTENT_MAX_WIDTH = 500;

export function PocketSwitcherSheet({
  onDone,
}: {
  onDone: () => void;
}): React.JSX.Element {
  const pockets = useWalletStore((s) => s.pockets);
  const activeAccount = useWalletStore((s) => s.activeAccount);
  const pocketBalances = useWalletStore((s) => s.pocketBalances);
  const switchPocket = useWalletStore((s) => s.switchPocket);
  const loadPockets = useWalletStore((s) => s.loadPockets);
  const theme = useTheme();
  const router = useRouter();

  const [switchingAccount, setSwitchingAccount] = useState<number | null>(null);

  useEffect(() => {
    loadPockets();
  }, [loadPockets]);

  const handleSelect = useCallback(
    async (account: number) => {
      if (switchingAccount !== null) return;
      if (account === activeAccount) {
        onDone();
        return;
      }
      setSwitchingAccount(account);
      await switchPocket(account);
      onDone();
    },
    [switchingAccount, activeAccount, switchPocket, onDone],
  );

  const handleManage = useCallback(() => {
    onDone();
    router.push("/pockets");
  }, [onDone, router]);

  return (
    <View
      className="w-full self-center gap-4"
      style={{ maxWidth: CONTENT_MAX_WIDTH }}
    >
      <View className="bg-surface rounded-2xl overflow-hidden">
        {pockets.map((pocket, idx) => {
          const isActive = pocket.account === activeAccount;
          const isSwitching = pocket.account === switchingAccount;
          const label =
            pocket.account === MAIN_POCKET_ACCOUNT
              ? t("pockets.mainName")
              : pocket.name;
          return (
            <ListItem
              key={pocket.account}
              icon="wallet-outline"
              iconBg={isActive ? "bg-green-500/15" : "bg-primary/10"}
              iconColor={isActive ? theme.colors.success : theme.colors.tint}
              title={label}
              subtitle={undefined}
              onPress={() => handleSelect(pocket.account)}
              showChevron={false}
              isLast={idx === pockets.length - 1}
              trailing={
                isSwitching ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (
                  <View className="flex-row items-center gap-2">
                    <AmountText value={pocketBalances[pocket.account] ?? 0n} />
                    {isActive ? (
                      <MaterialCommunityIcons
                        name="check-circle"
                        size={22}
                        color={theme.colors.success}
                      />
                    ) : null}
                  </View>
                )
              }
            />
          );
        })}
      </View>

      <View className="bg-surface rounded-2xl overflow-hidden">
        <ListItem
          icon="cog-outline"
          title={t("pockets.manage")}
          onPress={handleManage}
          isLast
        />
      </View>
    </View>
  );
}
```

> Verify the exact `ListItem` props and `AmountText` prop name against `src/ui/components/ListItem.tsx` / `AmountText.tsx` and adjust names if they differ (e.g. `AmountText` may take `amount` not `value`). Do NOT invent props — read the component first.

- [ ] **Step 3: Implement `MovePocketSheet`**

Create `src/ui/sheets/MovePocketSheet.tsx`:

```tsx
/**
 * Move-between-Pockets sheet body. Picks a destination Pocket + amount and calls
 * wallet-store.moveBetweenPockets (an on-chain self-transfer from the active
 * Pocket). Content-only body for a Bloom `<Dialog placement="bottom">`.
 */

import type React from "react";
import { useCallback, useMemo, useState } from "react";
import { View, Text } from "react-native";
import { parseFairToUnits } from "@fairco.in/core";
import { useTheme } from "@oxyhq/bloom/theme";
import { useWalletStore, FEE_RATES } from "../../wallet/wallet-store";
import { MAIN_POCKET_ACCOUNT } from "../../wallet/pockets";
import { AmountInput, Button, ListItem } from "../components";
import { t } from "../../i18n";

const SECTION_LABEL =
  "text-muted-foreground text-xs font-semibold uppercase tracking-wider";

export function MovePocketSheet({
  onDone,
}: {
  onDone: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const pockets = useWalletStore((s) => s.pockets);
  const activeAccount = useWalletStore((s) => s.activeAccount);
  const moveBetweenPockets = useWalletStore((s) => s.moveBetweenPockets);

  const destinations = useMemo(
    () => pockets.filter((p) => p.account !== activeAccount),
    [pockets, activeAccount],
  );
  const [toAccount, setToAccount] = useState<number | null>(
    destinations[0]?.account ?? null,
  );
  // `amount` is the user-facing FAIR decimal string (same contract as SendSheet).
  const [amount, setAmount] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountSats = useMemo<bigint | null>(() => parseFairToUnits(amount), [amount]);
  const canMove = toAccount !== null && amountSats !== null && amountSats > 0n;

  const handleMove = useCallback(async () => {
    if (toAccount === null || amountSats === null || amountSats <= 0n) return;
    setBusy(true);
    setError(null);
    try {
      // Same medium fee-rate the send flow defaults to (FEE_RATES is the single
      // source of truth for fee-per-byte; sendTransaction takes a numeric rate).
      await moveBetweenPockets(toAccount, amountSats, FEE_RATES.medium);
      onDone();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("pockets.move.failed"));
    } finally {
      setBusy(false);
    }
  }, [toAccount, amountSats, moveBetweenPockets, onDone]);

  return (
    <View className="w-full self-center gap-4" style={{ maxWidth: 500 }}>
      <View>
        <Text className={SECTION_LABEL}>{t("pockets.move.to")}</Text>
        <View className="bg-surface rounded-2xl overflow-hidden mt-2">
          {destinations.map((pocket, idx) => {
            const selected = pocket.account === toAccount;
            const label =
              pocket.account === MAIN_POCKET_ACCOUNT
                ? t("pockets.mainName")
                : pocket.name;
            return (
              <ListItem
                key={pocket.account}
                icon="wallet-outline"
                iconColor={selected ? theme.colors.success : theme.colors.tint}
                title={label}
                onPress={() => setToAccount(pocket.account)}
                showChevron={false}
                isLast={idx === destinations.length - 1}
                trailing={selected ? <Text>✓</Text> : undefined}
              />
            );
          })}
        </View>
      </View>

      <View>
        <Text className={SECTION_LABEL}>{t("pockets.move.amountLabel")}</Text>
        <AmountInput value={amount} onValueChange={setAmount} />
      </View>

      {error ? (
        <View className="bg-destructive/10 rounded-2xl p-3">
          <Text className="text-destructive text-sm text-center">{error}</Text>
        </View>
      ) : null}

      <Button
        title={t("pockets.move.cta")}
        onPress={handleMove}
        variant="primary"
        disabled={busy || !canMove}
      />
    </View>
  );
}
```

> Contracts confirmed against the real send flow (`src/ui/sheets/SendSheet.tsx`): `AmountInput` is string-based (`value: string`, `onValueChange: (v: string) => void`); `parseFairToUnits(str): bigint | null` (from `@fairco.in/core`) converts to sats; `FEE_RATES` (exported from `wallet-store.ts:790`) maps `FeeLevel = "low" | "medium" | "high"` → numeric fee-per-byte; `sendTransaction`/`moveBetweenPockets` take the numeric rate. `AmountText` (used in the switcher/list) is `value: bigint` — correct as written.

- [ ] **Step 4: Implement the Pockets management screen**

Create `app/pockets.tsx` (modeled on `app/wallets.tsx` — list + create/rename/delete + a "Move funds" entry that opens `MovePocketSheet`):

```tsx
/**
 * Pockets management screen. Lists the wallet's Pockets, creates/renames/deletes
 * them, and opens the move sheet. Presented as a screen from the switcher's
 * "Manage pockets" row and from settings. Modeled on app/wallets.tsx.
 */

import { useCallback, useState } from "react";
import { View, Text, ScrollView, Modal, TextInput, ActivityIndicator } from "react-native";
import { SafeAreaView } from "../src/ui/safe-area-view";
import { useRouter, useFocusEffect } from "expo-router";
import { useWalletStore } from "../src/wallet/wallet-store";
import { MAIN_POCKET_ACCOUNT } from "../src/wallet/pockets";
import { ListItem, Button, Badge, ScreenHeader, AmountText } from "../src/ui/components";
import { MovePocketSheet } from "../src/ui/sheets/MovePocketSheet";
import { useTheme } from "@oxyhq/bloom/theme";
import { Dialog, useDialogControl } from "@oxyhq/bloom/dialog";
import { t } from "../src/i18n";

const SECTION_LABEL =
  "text-muted-foreground text-xs font-semibold uppercase tracking-wider";

export default function PocketsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const pockets = useWalletStore((s) => s.pockets);
  const activeAccount = useWalletStore((s) => s.activeAccount);
  const pocketBalances = useWalletStore((s) => s.pocketBalances);
  const loading = useWalletStore((s) => s.loading);
  const loadPockets = useWalletStore((s) => s.loadPockets);
  const switchPocket = useWalletStore((s) => s.switchPocket);
  const createPocket = useWalletStore((s) => s.createPocket);
  const renamePocket = useWalletStore((s) => s.renamePocket);
  const deletePocket = useWalletStore((s) => s.deletePocket);

  const [showCreate, setShowCreate] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ account: number; name: string } | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ account: number; name: string } | null>(null);

  const moveControl = useDialogControl();
  const deleteControl = useDialogControl();
  const messageControl = useDialogControl();
  const [message, setMessage] = useState<string>("");

  useFocusEffect(
    useCallback(() => {
      loadPockets();
    }, [loadPockets]),
  );

  const openMessage = useCallback((text: string) => {
    setMessage(text);
    messageControl.open();
  }, [messageControl]);

  const submitCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("pockets.create.error.nameRequired"));
      return;
    }
    setShowCreate(false);
    setName("");
    setError(null);
    try {
      await createPocket(trimmed);
    } catch {
      openMessage(t("pockets.create.error.failed"));
    }
  }, [name, createPocket, openMessage]);

  const submitRename = useCallback(async () => {
    if (!renameTarget) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("pockets.create.error.nameRequired"));
      return;
    }
    const target = renameTarget;
    setRenameTarget(null);
    setName("");
    setError(null);
    await renamePocket(target.account, trimmed);
  }, [renameTarget, name, renamePocket]);

  const requestDelete = useCallback((account: number, pocketName: string) => {
    if (account === MAIN_POCKET_ACCOUNT) {
      openMessage(t("pockets.delete.cannotMain"));
      return;
    }
    setPendingDelete({ account, name: pocketName });
    deleteControl.open();
  }, [deleteControl, openMessage]);

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center" edges={["top", "bottom", "left", "right"]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom", "left", "right"]}>
      <ScreenHeader
        title={t("pockets.title")}
        subtitle={
          pockets.length === 1
            ? t("pockets.subtitle.one", { count: pockets.length })
            : t("pockets.subtitle.other", { count: pockets.length })
        }
        onBack={() => router.back()}
      />
      <ScrollView className="flex-1" contentContainerClassName="px-5 pt-4 pb-8">
        <View className="mb-6">
          {pockets.map((pocket, idx) => {
            const isActive = pocket.account === activeAccount;
            const label = pocket.account === MAIN_POCKET_ACCOUNT ? t("pockets.mainName") : pocket.name;
            return (
              <ListItem
                key={pocket.account}
                icon="wallet-outline"
                iconBg={isActive ? "bg-green-500/15" : "bg-primary/10"}
                iconColor={isActive ? theme.colors.success : theme.colors.tint}
                title={label}
                isLast={idx === pockets.length - 1}
                onPress={() => {
                  if (!isActive) switchPocket(pocket.account);
                }}
                onLongPress={() => {
                  if (pocket.account !== MAIN_POCKET_ACCOUNT) {
                    requestDelete(pocket.account, label);
                  }
                }}
                trailing={
                  <View className="flex-row items-center gap-2">
                    <AmountText value={pocketBalances[pocket.account] ?? 0n} />
                    {isActive ? <Badge text={t("pockets.active")} variant="success" /> : null}
                  </View>
                }
              />
            );
          })}
        </View>

        <View className="gap-3">
          <Button title={t("pockets.createCta")} onPress={() => { setName(""); setError(null); setShowCreate(true); }} variant="primary" />
          <Button title={t("pockets.move.title")} onPress={() => moveControl.open()} variant="outline" />
        </View>
      </ScrollView>

      {/* Create / rename modal (shared TextInput modal) */}
      <Modal visible={showCreate || renameTarget !== null} transparent animationType="fade" onRequestClose={() => { setShowCreate(false); setRenameTarget(null); }}>
        <View className="flex-1 bg-black/70 items-center justify-center px-8">
          <View className="bg-background border border-border rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-foreground text-lg font-bold mb-5 text-center">
              {renameTarget ? t("pockets.rename.title") : t("pockets.create.title")}
            </Text>
            <View className="gap-4">
              <View>
                <Text className={SECTION_LABEL}>{t("pockets.create.nameLabel")}</Text>
                <TextInput
                  className="bg-surface rounded-2xl px-4 py-3.5 text-foreground text-base mt-2"
                  placeholder={t("pockets.create.namePlaceholder")}
                  placeholderTextColor={theme.colors.textSecondary}
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                  autoCorrect={false}
                />
              </View>
              {error ? (
                <View className="bg-destructive/10 rounded-2xl p-3">
                  <Text className="text-destructive text-sm text-center">{error}</Text>
                </View>
              ) : null}
              <View className="gap-3">
                <Button
                  title={renameTarget ? t("pockets.rename.cta") : t("pockets.create.cta")}
                  onPress={renameTarget ? submitRename : submitCreate}
                  variant="primary"
                />
                <Button title={t("common.cancel")} onPress={() => { setShowCreate(false); setRenameTarget(null); setName(""); setError(null); }} variant="secondary" />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Dialog control={moveControl} placement="bottom" title={t("pockets.move.title")}>
        <MovePocketSheet onDone={() => moveControl.close()} />
      </Dialog>

      <Dialog
        control={deleteControl}
        placement="bottom"
        title={t("pockets.delete.title")}
        description={pendingDelete ? t("pockets.delete.description", { name: pendingDelete.name }) : ""}
        actions={[
          {
            label: t("common.delete"),
            color: "destructive",
            onPress: async () => {
              if (!pendingDelete) return;
              try {
                await deletePocket(pendingDelete.account);
              } catch (err: unknown) {
                openMessage(err instanceof Error ? err.message : t("pockets.delete.notEmpty"));
              }
              setPendingDelete(null);
            },
          },
          { label: t("common.cancel"), color: "cancel" },
        ]}
      />

      <Dialog
        control={messageControl}
        placement="bottom"
        title={t("common.error")}
        description={message}
        actions={[{ label: t("common.ok") }]}
      />
    </SafeAreaView>
  );
}
```

> Match `ListItem`/`Badge`/`AmountText`/`ScreenHeader`/`Button` prop contracts against their real component files before finishing; the `Dialog` action/color API against `@oxyhq/bloom/dialog` (as used in `app/wallets.tsx`). Reuse `common.cancel`/`common.delete`/`common.ok`/`common.error` keys already present in `languages.ts`.

- [ ] **Step 5: Mount the switcher from the home header**

In `app/(tabs)/index.tsx`, add a `useDialogControl()` for the Pocket switcher next to `walletSwitcherControl` (`:162`):

```tsx
  const pocketSwitcherControl = useDialogControl();
```

Add a small pill under the header balance that shows the active Pocket name and opens the sheet (place it near the balance block; use the active Pocket name from the store):

```tsx
  const pockets = useWalletStore((s) => s.pockets);
  const activeAccount = useWalletStore((s) => s.activeAccount);
  const activePocketName =
    pockets.find((p) => p.account === activeAccount)?.name ??
    t("pockets.mainName");
```

```tsx
  {/* Active-Pocket pill — opens the Pocket switcher */}
  <Pressable
    className="self-start bg-surface rounded-full px-3 py-1.5 mt-1"
    onPress={() => pocketSwitcherControl.open()}
  >
    <Text className="text-foreground text-sm font-medium">
      {activePocketName}
    </Text>
  </Pressable>
```

And mount the Dialog alongside the existing `walletSwitcherControl` Dialog (`:528-534`):

```tsx
  <Dialog
    control={pocketSwitcherControl}
    placement="bottom"
    title={t("pockets.switcherTitle")}
  >
    <PocketSwitcherSheet onDone={() => pocketSwitcherControl.close()} />
  </Dialog>
```

Add the imports at the top of the file:

```tsx
import { Pressable } from "react-native";
import { PocketSwitcherSheet } from "../../src/ui/sheets/PocketSwitcherSheet";
```

> `Pressable` may already be imported; don't duplicate. Ensure `loadPockets()` runs when home mounts — either call it in the existing focus/refresh path or add a mount effect `useEffect(() => { loadPockets(); }, [loadPockets])` (loadPockets is idempotent).

- [ ] **Step 6: Typecheck + lint**

Run: `cd ~/FairCoinWorkspace/FAIRWallet && bun run typecheck && bun run lint`
Expected: no type errors, no lint errors.

- [ ] **Step 7: Native verify — full Pockets UX (foregrounded, testnet)**

On a foregrounded emulator/device: open the home Pocket pill → switcher lists Pockets with balances and a checkmark on the active one. Create "Savings"; switch to it (empty balance + fresh receive address); rename it; from `/pockets` open "Move" and move funds main→Savings; confirm balances update; delete an empty Pocket; confirm the main Pocket cannot be deleted. Verify no white screen / navigation race on cold start (per expo-router rules — a backgrounded tab gives false readings, so keep the tab foregrounded).
Expected: every Pockets flow works; the main Pocket is unaffected by other Pockets.

- [ ] **Step 8: Commit**

```bash
cd ~/FairCoinWorkspace/FAIRWallet
git add src/ui/sheets/PocketSwitcherSheet.tsx src/ui/sheets/MovePocketSheet.tsx app/pockets.tsx src/i18n/languages.ts "app/(tabs)/index.tsx"
git commit -m "feat(ui): Pockets switcher, management screen, and move sheet"
```

---

## Task 6: Subtree integration into OxyPay (documentation only — no product code)

Record how OxyPay consumes this once it lands in FAIRWallet upstream. This task writes/updates docs only; it produces no product code and no test.

**Files:**
- Modify: `~/Oxy/OxyPay/AGENTS.md` (or the OxyPay wallet package's notes) — add the subtree + divergence note below.

- [ ] **Step 1: Land Pockets on FAIRWallet upstream**

Push `feat/pockets`, open the PR against `FairCoinOfficial/FAIRWallet`, get CI green, merge to the branch OxyPay tracks (confirm which branch OxyPay's subtree follows — the current working branch is `chore/expo-sdk-57`).

- [ ] **Step 2: Pull into OxyPay via subtree**

OxyPay's `packages/frontend` is the FAIRWallet subtree. From the OxyPay repo root:

```bash
cd ~/Oxy/OxyPay
git subtree pull --prefix=packages/frontend fairwallet <branch> --squash
```

(Where `fairwallet` is the git remote pointing at `FairCoinOfficial/FAIRWallet`; add it once with `git remote add fairwallet https://github.com/FairCoinOfficial/FAIRWallet.git` if absent. `<branch>` = the branch merged in Step 1.)

- [ ] **Step 3: OxyPay divergence — hide multi-wallet, surface Pockets**

Per design §4.7, OxyPay is single-wallet. In OxyPay's divergence (NOT upstream): hide the multi-wallet switcher entry points (the wallet-name header switcher in `app/(tabs)/index.tsx` and the `app/wallets.tsx` route) and surface the Pocket pill / `/pockets` instead. The underlying multi-wallet code stays dormant in the subtree — do not delete it upstream. Pockets becomes the user-facing "sub-balances" concept; "Wallets" is not shown.

- [ ] **Step 4: Record the note in OxyPay AGENTS.md**

Add to `~/Oxy/OxyPay/AGENTS.md`:

```
## Pockets (from FAIRWallet upstream)
Pockets (Revolut-style sub-balances = BIP44 account indices) are implemented in
FAIRWallet upstream and pulled in via:
  git subtree pull --prefix=packages/frontend fairwallet <branch> --squash
Never edit Pockets/wallet-core in OxyPay directly — fix upstream in
~/FairCoinWorkspace/FAIRWallet, then subtree-pull. OxyPay hides FAIRWallet's
multi-wallet switcher (app/wallets.tsx) and surfaces Pockets instead; the
multi-wallet code stays dormant in the subtree. Account 0 = the wallet's main
Pocket; each Pocket has its own SQLite file (fairwallet_<id>_acct<n>.db),
cursors, xpub, and UTXO set. Moving between Pockets is an on-chain self-transfer.
```

- [ ] **Step 5: Commit the doc**

```bash
cd ~/Oxy/OxyPay
git add AGENTS.md
git commit -m "docs(oxypay): note Pockets subtree-pull + multi-wallet divergence"
```

---

## Subtree integration (summary)

Once WS-P is merged upstream in FAIRWallet, OxyPay consumes it with a single subtree pull — no cherry-picking, no local edits to wallet-core:

```bash
cd ~/Oxy/OxyPay
git remote add fairwallet https://github.com/FairCoinOfficial/FAIRWallet.git   # once
git subtree pull --prefix=packages/frontend fairwallet <branch> --squash
```

OxyPay then hides the multi-wallet switcher (`app/wallets.tsx` + the home wallet-name switcher) and surfaces the Pocket pill + `/pockets`. Because Pockets is pure BIP44/wallet-core with zero Oxy dependency, OxyPay's identity-derived single seed (WS-F) simply becomes the seed under which `account'` indices are the Pockets — no further wiring needed for Pockets itself.

---

## Self-Review

**1. Spec coverage (design §4.6 / §8 / §10 WS-P):**
- "Thread an `account` parameter through `fromSeed`/`fromXpub`/`accountXpub`/`deriveAndStore` and the path string (currently hardcodes `account'=0`)" → **Task 1** (`fromSeed`/`fromMnemonic`/`fromXpub` + path string + `getAccount`; `accountXpub` already reads from the account key so it is per-account once the account key is account-aware — covered by the Task 1 test `accountXpub differs per account`).
- "The lower `@fairco.in/core` layer already accepts an `account` arg" → used as the cross-check oracle in Task 1 & Task 4 tests (`deriveAddress(seed, account, ...)`).
- "the single-account module globals (one `keyManager`/`utxoSet`/`database`) become account-aware (partition UTXOs per pocket, or N managers)" → **Task 2** (per-account DB file; globals point at the active Pocket) + **Task 3** (`switchPocket` re-inits them).
- "each a fully isolated BIP32 subtree with its own external/change branches, gap-limit cursors, xpub, and UTXO set" → per-account KeyManager (own cursors/xpub, Task 1) + per-account DB file (own UTXO set/addresses, Task 2).
- "Pockets data model (create/rename/delete/list, persisted)" → **Task 3** (pure registry + persistence + actions).
- "Moving funds between pockets = an ordinary on-chain self-transfer … reuses `buildTransaction`" → **Task 4** (`moveBetweenPockets` derives the destination address then calls the existing `sendTransaction`, which builds via `buildTransaction`). No new primitive.
- "Pockets UI (list, create/rename/delete pocket, per-pocket balance, move-between)" → **Task 5**.
- "OxyPay pulls this via subtree; hides the multi-wallet switcher and surfaces Pockets" → **Task 6** + Subtree note.
- §8 testing: derivation determinism / per-account isolation / regression of single-account behaviour → Task 1 & Task 4 pure tests + Task 2 Step 9/10 regression; move-between self-transfer → Task 4 Step 7 testnet; native foregrounded verification → Tasks 3/4/5.
- Backward compatibility (preserve existing single-account behaviour) → default `account = 0` everywhere; account-0 legacy DB filename (Task 2 `db-name` test); Task 1 "account 0 addresses unchanged" test; Task 2 Step 10 existing-wallet smoke.

**2. Placeholder scan:** No "TBD"/"similar to Task N"/"add error handling"-style placeholders. Every code step carries complete code. Two deliberate, called-out verification caveats remain (not placeholders): UI component prop names (`ListItem`/`AmountInput`/`AmountText`/`Dialog`) must be matched against their real files, and the i18n block shape (nested vs dotted) must match `languages.ts` — these are read-then-match instructions, not missing code, because those exact prop/shape contracts weren't read during planning.

**3. Type/name consistency across tasks:**
- `account` — identical name and `number` type in `KeyManager.fromSeed/fromMnemonic/fromXpub`, `Database.open`, `databaseFileName`, `initialize`, `resolveMoveDestinationAddress`, and every store action.
- `PocketInfo { account; name; createdAt }` — defined once in `pockets.ts`, imported by `pockets-store.ts` and `wallet-store.ts` and the UI.
- `MAIN_POCKET_ACCOUNT = 0` — single source in `pockets.ts`, used by store + UI (never a bare `0` literal for the main-Pocket concept in UI).
- The pure `renamePocket`/`removePocket` are imported into the store aliased as `renamePocketList`/`removePocketList` to avoid colliding with the store actions `renamePocket`/`deletePocket` — consistent everywhere they're used.
- `resolveMoveDestinationAddress(seed, network, account, nextUnusedIndex): DerivedAddress` — same signature in its module, test, and the store call.
- `DerivedAddress { address; path; index }` — reused from `key-manager.ts` (not redefined).
- Store action names match between `WalletState` declarations and implementations: `loadPockets`, `switchPocket`, `createPocket`, `renamePocket`, `deletePocket`, `moveBetweenPockets`; state fields `activeAccount`, `pockets`, `pocketBalances`.

### Assumptions the reviewer should verify against the FAIRWallet code
1. **`@fairco.in/core` `deriveAddress(seed, account, change, index, network)` produces the SAME address as the KeyManager path for a given `(account, change, index)`.** Confirmed for account 0 by the existing `accountXpub` test's independent HDKey derivation; the Task 1 test asserts it for account 1+ against `deriveAddress`. If the two ever diverge (different version bytes / hashing), Task 1's cross-check test will fail — that's the intended guard.
2. **DB partitioning by file (one SQLite file per Pocket) is preferred over adding an `account` column to `addresses`/`utxos`.** Chosen because it exactly mirrors the existing per-wallet DB partitioning (`Database.open(walletId)` → `fairwallet_<id>.db`) and keeps account 0 on the legacy file (zero migration). If the reviewer prefers a single-file `account`-column schema, Tasks 2–4 change shape (schema migration + `WHERE account = ?` everywhere) — flag before executing.
3. **`initialize` may resolve the active Pocket itself when `account` is omitted** (reads `getActivePocket(walletId)`). This keeps boot/unlock/`switchWallet` restoring the last-active Pocket without touching those call sites. Verify no existing caller relies on `initialize` ALWAYS opening account 0.
4. **Watch-only wallets have no Pockets.** `initialize`'s xpub branch stays account-0; the UI must hide Pockets when `isWatchOnly`. Verify the UI gates on `isWatchOnly` (add the guard in Task 5 if the home pill is shown for watch-only wallets).
5. **UI component contracts** — resolved against `SendSheet.tsx`/`WalletSwitcherSheet.tsx`/`app/wallets.tsx`: `AmountInput` is `value: string` + `onValueChange`; `AmountText` is `value: bigint`; amount→sats via `parseFairToUnits` (`@fairco.in/core`); `FeeLevel = "low"|"medium"|"high"` with `FEE_RATES[level]` numeric (`wallet-store.ts:76,790`). The `MovePocketSheet` code uses these directly. Still verify `ListItem` (`icon`/`iconBg`/`iconColor`/`title`/`trailing`/`showChevron`/`isLast`/`onLongPress`), `Badge` (`text`/`variant`), and the Bloom `Dialog` action/color API against their real files while wiring Task 5 (these were read only via `WalletSwitcherSheet`/`app/wallets.tsx` usage, not their definitions).
6. **`common.*` i18n keys** (`common.cancel`/`common.delete`/`common.ok`/`common.error`) are assumed to already exist in `languages.ts` (used by `app/wallets.tsx`). Confirm before reusing; add if missing.

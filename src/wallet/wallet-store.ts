/**
 * Zustand store for FairCoin wallet state management.
 * Central state container used by UI components.
 * Integrates KeyManager for HD key derivation, UTXOSet for coin tracking,
 * and Database for persistence.
 *
 * Supports multi-wallet: users can create, switch, and manage
 * multiple wallets, each with its own mnemonic and chain data.
 */

import { create, type StoreApi } from "zustand";
import {
  generateMnemonic,
  validateMnemonic,
  getNetwork,
  hexToBytes,
  bytesToHex,
  decodeAddress,
  buildTransaction,
  signInput,
  serializeTransaction,
  hashTransaction,
  type NetworkType,
  type NetworkConfig,
  type UTXO as TxUTXO,
} from "@fairco.in/core";
import type { ParsedTransaction } from "../p2p/messages";
import { SPVClient } from "../p2p/spv-client";
import { planRescan, type RescanProgress } from "../p2p/rescan";
import { DatabaseHeaderStore } from "../p2p/header-store";
import { createSocketProvider } from "../p2p/socket-provider";
import { KeyManager } from "./key-manager";
import { UTXOSet, type UTXO } from "./utxo-set";
import {
  selectInputsForSend,
  estimateSend as computeSendEstimate,
  type SendEstimate,
} from "./coin-selection";
import { applyTransactionToWallet } from "./apply-transaction";
import {
  saveMnemonic,
  getMnemonic,
  clearAll as clearSecureStore,
  getWalletIndex,
  getActiveWalletId,
  setActiveWalletId,
  addWalletToIndex,
  removeWalletFromIndex,
  renameWallet,
  saveWalletMnemonic,
  getWalletMnemonic,
  deleteWalletMnemonic,
  saveWalletXpub,
  isWatchOnly as checkIsWatchOnly,
} from "../storage/secure-store";
import type { WalletInfo } from "../storage/secure-store";
import { Database } from "../storage/database";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FeeLevel = "low" | "medium" | "high";

export interface WalletTransaction {
  txid: string;
  amount: bigint; // positive = received, negative = sent
  address: string;
  timestamp: number;
  confirmations: number;
  type: "send" | "receive" | "stake" | "masternode_reward";
}

export interface MasternodeUTXO {
  txid: string;
  vout: number;
  address: string;
  confirmations: number;
}

export interface WalletState {
  // Initialization
  initialized: boolean;
  loading: boolean;
  error: string | null;
  network: NetworkType;

  // Multi-wallet
  activeWalletId: string | null;
  activeWalletName: string;
  wallets: WalletInfo[];
  isWatchOnly: boolean;

  // Balance
  balance: bigint;
  confirmedBalance: bigint;
  unconfirmedBalance: bigint;

  // Sync
  syncProgress: number; // 0-100
  chainHeight: number;
  connectedPeers: number;
  isSyncing: boolean;
  networkStatus: string; // human-readable P2P status

  // Addresses
  currentReceiveAddress: string;
  addresses: string[];

  // Transactions
  transactions: WalletTransaction[];

  // Masternode
  masternodeUTXOs: MasternodeUTXO[];

  // Coin control
  selectedUTXOs: Array<{ txid: string; vout: number }>;

  // Actions
  initialize: (mnemonic: string, walletId?: string) => Promise<void>;
  createWallet: () => Promise<string>;
  restoreWallet: (mnemonic: string) => Promise<void>;
  refreshBalance: () => void;
  getNewAddress: () => string;
  getBuyDeliveryAddress: () => Promise<string>;
  sendTransaction: (
    toAddress: string,
    amount: bigint,
    feeRate: number,
  ) => Promise<string>;
  refreshMasternodeUTXOs: () => void;
  estimateFee: (feeLevel: FeeLevel) => bigint;
  estimateSend: (amount: bigint, feeRate: number) => SendEstimate;
  hasWallet: () => Promise<boolean>;
  wipeWallet: () => Promise<void>;
  rescanWallet: () => Promise<void>;

  // Multi-wallet actions
  loadWalletList: () => Promise<void>;
  switchWallet: (walletId: string) => Promise<void>;
  createNewWallet: (name: string) => Promise<string>;
  importWallet: (name: string, mnemonic: string) => Promise<void>;
  importWatchOnly: (name: string, xpub: string) => Promise<void>;
  deleteWallet: (walletId: string) => Promise<void>;
  renameActiveWallet: (name: string) => Promise<void>;

  // Network switching
  switchNetwork: (network: NetworkType) => Promise<void>;

  // Backup
  exportBackup: () => Promise<string>;
  importBackup: (json: string) => Promise<void>;

  // Coin control
  setSelectedUTXOs: (utxos: Array<{ txid: string; vout: number }>) => void;
  clearSelectedUTXOs: () => void;
}

// ---------------------------------------------------------------------------
// UUID generator (no external deps)
// ---------------------------------------------------------------------------

/**
 * Prefix stored in place of a mnemonic for watch-only wallets:
 * `xpub:<account-level extended public key>`. `initialize` routes any secret
 * with this prefix to the public-only KeyManager (no private keys derived).
 */
const XPUB_MARKER_PREFIX = "xpub:";

function generateWalletId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---------------------------------------------------------------------------
// Internal state (not exposed to Zustand consumers)
// ---------------------------------------------------------------------------

let keyManager: KeyManager | null = null;
let utxoSet: UTXOSet | null = null;
let database: Database | null = null;
let networkConfig: NetworkConfig | null = null;
let spvClient: SPVClient | null = null;
// Guards the historical-rescan driver so the periodic trigger never starts a
// second concurrent scan.
let rescanDriverRunning = false;

/**
 * Get the current Database instance. Returns null if the wallet is not initialized.
 * Used by other stores (contacts, tx notes) that need database access.
 */
export function getDatabase(): Database | null {
  return database;
}

// ---------------------------------------------------------------------------
// Incoming transaction processing (SPV receive path)
// ---------------------------------------------------------------------------

type WalletSet = StoreApi<WalletState>["setState"];
type WalletGet = StoreApi<WalletState>["getState"];

/**
 * Push the current in-memory balance and transaction list into the store and
 * persist nothing (callers are responsible for DB writes). Centralises the
 * derived-state update so every receive/spend path stays consistent.
 */
function publishBalance(set: WalletSet): void {
  if (!utxoSet) {
    return;
  }
  set({
    balance: utxoSet.getBalance(),
    confirmedBalance: utxoSet.getConfirmedBalance(),
    unconfirmedBalance: utxoSet.getUnconfirmedBalance(),
  });
}

/**
 * Merge a transaction into the in-memory `transactions` list, replacing any
 * existing entry with the same txid (so a mempool receive is upgraded in place
 * once it confirms, rather than duplicated).
 */
function upsertWalletTransaction(set: WalletSet, tx: WalletTransaction): void {
  set((state) => {
    const filtered = state.transactions.filter((t) => t.txid !== tx.txid);
    return { transactions: [tx, ...filtered] };
  });
}

/**
 * Resolve the block height and confirmation count for a transaction given the
 * hash of the block that contains it. `blockHash` is in the header store's
 * internal byte order (as produced by the SPV client). Returns height -1 and
 * zero confirmations for unconfirmed (mempool) transactions.
 */
async function resolveConfirmation(
  blockHash: Uint8Array | undefined,
  chainTip: number,
): Promise<{ blockHeight: number; blockHash: string; confirmations: number }> {
  if (!blockHash || !database) {
    return { blockHeight: -1, blockHash: "", confirmations: 0 };
  }

  const blockHashHex = bytesToHex(blockHash);
  const header = await database.getHeaderByHash(blockHashHex);
  if (!header) {
    // The containing block header has not been stored yet (the tx arrived
    // ahead of its merkle block during sync). Treat as unconfirmed for now;
    // `reconcileConfirmations` will upgrade it once the header lands.
    return { blockHeight: -1, blockHash: blockHashHex, confirmations: 0 };
  }

  const tip = chainTip > 0 ? chainTip : header.height;
  const confirmations = Math.max(0, tip - header.height + 1);
  return { blockHeight: header.height, blockHash: blockHashHex, confirmations };
}

/**
 * Process a transaction delivered by the SPV client.
 *
 * Credits every output that pays one of our addresses (adding a UTXO and
 * recording a "receive"), and debits every input that spends one of our
 * existing UTXOs (marking it spent and recording a "send"). All changes are
 * mirrored to SQLite so balances and history survive an app restart.
 *
 * Idempotent: replaying the same transaction (e.g. on reconnect, or when the
 * same tx arrives loose and again inside a merkle block) does not double-count.
 */
async function processIncomingTransaction(
  tx: ParsedTransaction,
  txid: string,
  blockHash: Uint8Array | undefined,
  set: WalletSet,
  get: WalletGet,
): Promise<void> {
  if (!keyManager || !utxoSet || !database || !networkConfig) {
    return;
  }

  const chainTip = get().chainHeight;
  const confirmation = await resolveConfirmation(blockHash, chainTip);
  const confirmed = confirmation.blockHeight >= 0;
  const now = Math.floor(Date.now() / 1000);

  // Apply the receive/spend logic against the in-memory UTXO set. This is the
  // single source of truth for "which outputs are ours / which inputs spend
  // ours" — shared with the unit tests so the tested path is the real path.
  const result = applyTransactionToWallet(
    utxoSet,
    tx,
    txid,
    (address) => keyManager?.ownsAddress(address) ?? false,
    networkConfig,
    confirmation,
  );

  if (!result.changed) {
    // Bloom-filter false positive: the tx matched the filter but touches none
    // of our outputs or UTXOs. Nothing to record.
    return;
  }

  // ---- Mirror credited outputs to SQLite ---------------------------------
  for (const { utxo } of result.credited) {
    await database.insertUTXO({
      txid: utxo.txid,
      vout: utxo.vout,
      address: utxo.address,
      value: utxo.value,
      script_pub_key: bytesToHex(utxo.scriptPubKey),
      spent: 0,
      block_height: utxo.blockHeight,
    });
  }

  // Mark matched receive addresses as used and extend the derivation /
  // Bloom-filter window so payments to higher-index addresses still arrive.
  let bloomNeedsRefresh = false;
  for (const address of result.receiveAddresses) {
    await database.markAddressUsed(address);
    if (keyManager.markAddressUsed(address)) {
      bloomNeedsRefresh = true;
    }
  }

  // ---- Mirror spent inputs to SQLite -------------------------------------
  // Record which tx spent the UTXO and at what height so a reorg can un-spend
  // it precisely if the spending block is later orphaned.
  for (const debit of result.debited) {
    await database.markUTXOSpent(
      debit.txid,
      debit.vout,
      txid,
      confirmation.blockHeight,
    );
  }

  // ---- Persist the transaction row and update derived state --------------
  await database.insertTransaction({
    txid,
    raw_hex: bytesToHex(tx.raw),
    block_height: confirmation.blockHeight,
    block_hash: confirmation.blockHash,
    timestamp: now,
    fee: 0,
    confirmed: confirmed ? 1 : 0,
  });

  // Net effect on this wallet: received outputs minus our spent inputs.
  // A pure receive is positive; spending our own coins (with change back to
  // us) nets negative by the amount that left the wallet.
  const net = result.receivedTotal - result.spentTotal;
  if (net !== 0n) {
    const spentAddress = result.debited[0]?.address ?? "";
    upsertWalletTransaction(set, {
      txid,
      amount: net,
      address: net > 0n ? (result.receiveAddresses[0] ?? "") : spentAddress,
      timestamp: now,
      confirmations: confirmation.confirmations,
      type: net > 0n ? "receive" : "send",
    });
  }

  publishBalance(set);

  if (bloomNeedsRefresh && spvClient && keyManager) {
    const addressHashes = keyManager
      .getAllAddresses()
      .map((addr) => decodeAddress(addr).hash);
    spvClient.setBloomFilter(addressHashes);
  }
}

/**
 * Replace the in-memory UTXO set with the unspent UTXOs currently in SQLite.
 * Used at init, and after a reorg rewind, to keep the in-memory set the single
 * source of truth for balance in lock-step with the persisted state.
 */
async function reloadUtxoSetFromDatabase(): Promise<void> {
  if (!utxoSet || !database) {
    return;
  }
  const fresh = new UTXOSet();
  const dbUtxos = await database.getUnspentUTXOs();
  for (const row of dbUtxos) {
    fresh.add({
      txid: row.txid,
      vout: row.vout,
      address: row.address,
      value: BigInt(row.value),
      scriptPubKey: hexToBytes(row.script_pub_key),
      blockHeight: row.block_height,
      confirmed: row.block_height >= 0,
    });
  }
  utxoSet = fresh;
}

/**
 * Roll the wallet back to `forkHeight` after the SPV client detects that a
 * longer chain has orphaned the blocks above it. The database rewind deletes
 * UTXOs created in orphaned blocks and restores UTXOs spent by orphaned
 * transactions; we then rebuild the in-memory set and balance from the
 * post-rewind database so nothing reflects the discarded chain.
 */
async function rewindWalletToHeight(
  forkHeight: number,
  set: WalletSet,
): Promise<void> {
  if (!database || !utxoSet) {
    return;
  }
  // The DB rewind prunes UTXOs and the `transactions` rows for orphaned blocks.
  await database.rewindToHeight(forkHeight);
  await reloadUtxoSetFromDatabase();

  // Reconcile the displayed transaction list with what survived in the
  // database: any tx whose row was pruned (confirmed only in an orphaned block)
  // is dropped. Unconfirmed sends/receives (still present in the DB) are kept
  // and will re-confirm via the receive path once the new chain includes them.
  const surviving = new Set<string>();
  for (const row of await database.getTransactions(10_000, 0)) {
    surviving.add(row.txid);
  }
  set((state) => ({
    transactions: state.transactions.filter((t) => surviving.has(t.txid)),
    chainHeight: forkHeight,
  }));
  publishBalance(set);
}

/**
 * Drive a historical rescan (SPV_AUDIT.md §6.3): find and credit transactions
 * that confirmed BEFORE the Bloom filter loaded (e.g. funds already sitting at
 * one of the wallet's addresses on a restored wallet).
 *
 * Reads persisted progress, plans the scan with {@link planRescan} (resuming an
 * incomplete scan or catching up newly-synced blocks), and asks the SPV client
 * to re-request each block as a filtered merkle block. Discovered matches flow
 * through the same idempotent `onTransaction` receive path, so nothing is
 * double-counted. Progress is persisted after every window for resumability.
 *
 * Best-effort and re-entrancy-guarded: the periodic trigger calls this whenever
 * headers advance, but only one scan runs at a time.
 */
async function runHistoricalRescan(set: WalletSet, get: WalletGet): Promise<void> {
  if (rescanDriverRunning || !database || !spvClient) {
    return;
  }
  // A rescan only makes sense once we have some chain and at least one peer to
  // serve the merkle blocks.
  const chainTip = get().chainHeight;
  if (chainTip <= 0) {
    return;
  }
  if (spvClient.getPeerManager().getReadyPeers().length === 0) {
    return;
  }

  const persistedRow = await database.getRescanState();
  const persisted: RescanProgress | null = persistedRow
    ? {
        startHeight: persistedRow.start_height,
        nextHeight: persistedRow.next_height,
        targetHeight: persistedRow.target_height,
        completed: persistedRow.completed === 1,
      }
    : null;

  // No wallet-birthday tracking yet: scan from genesis. The FairCoin chain is
  // young, so a full scan is acceptable; a future birthday field can narrow it.
  const birthday = 0;
  const plan = planRescan(persisted, birthday, chainTip);
  if (!plan) {
    return;
  }

  rescanDriverRunning = true;
  try {
    await spvClient.rescan({
      fromHeight: plan.startHeight,
      toHeight: plan.targetHeight,
      resumeFrom: plan.resumeFrom,
      onProgress: async (progress) => {
        if (!database) {
          return;
        }
        await database.saveRescanState({
          start_height: progress.startHeight,
          next_height: progress.nextHeight,
          target_height: progress.targetHeight,
          completed: progress.completed ? 1 : 0,
        });
      },
    });
  } finally {
    rescanDriverRunning = false;
  }
}

/**
 * Re-derive confirmation counts for stored UTXOs and transactions when the
 * chain tip advances. Promotes any UTXO whose containing block is now known
 * from unconfirmed to confirmed, and refreshes the displayed balance.
 */
async function reconcileConfirmations(
  set: WalletSet,
  get: WalletGet,
): Promise<void> {
  if (!utxoSet || !database) {
    return;
  }

  const tip = get().chainHeight;
  if (tip <= 0) {
    return;
  }

  let changed = false;
  for (const utxo of utxoSet.getAllUTXOs()) {
    if (utxo.confirmed || utxo.blockHeight < 0) {
      continue;
    }
    // A previously-unconfirmed UTXO now sits at or below the tip: confirm it.
    if (utxo.blockHeight <= tip) {
      utxoSet.add({ ...utxo, confirmed: true });
      changed = true;
    }
  }

  if (changed) {
    publishBalance(set);
  }
}

// ---------------------------------------------------------------------------
// Fee estimation constants (satoshis per byte)
// ---------------------------------------------------------------------------

const FEE_RATES: Record<FeeLevel, number> = {
  low: 1,
  medium: 5,
  high: 10,
};

// Average P2PKH transaction ~226 bytes
const AVERAGE_TX_SIZE = 226;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Reset all in-memory wallet state to defaults. */
function resetWalletInternals(): void {
  if (spvClient) {
    spvClient.stop();
    spvClient = null;
  }
  keyManager = null;
  utxoSet = null;
  database = null;
  networkConfig = null;
  rescanDriverRunning = false;
}

const DEFAULT_WALLET_STATE = {
  initialized: false,
  loading: false,
  error: null,
  balance: 0n,
  confirmedBalance: 0n,
  unconfirmedBalance: 0n,
  syncProgress: 0,
  chainHeight: 0,
  connectedPeers: 0,
  isSyncing: false,
  networkStatus: "Offline",
  currentReceiveAddress: "",
  addresses: [] as string[],
  transactions: [] as WalletTransaction[],
  masternodeUTXOs: [] as MasternodeUTXO[],
  isWatchOnly: false,
  selectedUTXOs: [] as Array<{ txid: string; vout: number }>,
} as const;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useWalletStore = create<WalletState>((set, get) => ({
  // Initial state
  initialized: false,
  loading: false,
  error: null,
  network: "mainnet",

  // Multi-wallet initial state
  activeWalletId: null,
  activeWalletName: "",
  wallets: [],
  isWatchOnly: false,

  balance: 0n,
  confirmedBalance: 0n,
  unconfirmedBalance: 0n,

  syncProgress: 0,
  chainHeight: 0,
  connectedPeers: 0,
  isSyncing: false,
  networkStatus: "Offline",

  currentReceiveAddress: "",
  addresses: [],

  transactions: [],

  masternodeUTXOs: [],

  selectedUTXOs: [],

  // -------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------

  initialize: async (mnemonic: string, walletId?: string): Promise<void> => {
    const state = get();
    if (state.initialized) {
      return;
    }

    set({ loading: true, error: null });

    try {
      networkConfig = getNetwork(state.network);
      database = await Database.open(walletId);
      // A wallet's stored secret is either a BIP39 mnemonic or the watch-only
      // marker `xpub:<extended public key>`. The marker MUST route to the
      // public-only KeyManager: feeding it into mnemonicToSeedSync would
      // silently derive a random spendable keypair (BIP39 doesn't validate),
      // producing a dangerous fake wallet (review finding C2).
      if (mnemonic.startsWith(XPUB_MARKER_PREFIX)) {
        const xpub = mnemonic.slice(XPUB_MARKER_PREFIX.length);
        keyManager = KeyManager.fromXpub(xpub, networkConfig);
      } else {
        keyManager = KeyManager.fromMnemonic(mnemonic, networkConfig);
      }
      utxoSet = new UTXOSet();

      // Load persisted UTXOs from database. A UTXO is confirmed iff it was
      // stored with a real block height (>= 0); mempool receives are stored
      // with height -1 and remain unconfirmed until their block is seen.
      await reloadUtxoSetFromDatabase();

      // Restore the BIP44 derivation cursors from persisted state so used
      // addresses are never re-issued across restarts and the lookahead window
      // (hence the Bloom filter) keeps watching the right addresses
      // (SPV_AUDIT.md §4.5). KeyManager.fromMnemonic resets the cursors to 0.
      const nextExternal = await database.getNextUnusedIndex(false);
      const nextChange = await database.getNextUnusedIndex(true);
      keyManager.restoreCursors(nextExternal, nextChange);

      // Load persisted addresses from database
      const dbAddresses = await database.getAddresses();
      const addressList = dbAddresses.map((a) => a.address);

      // Get receive address
      const unused = await database.getUnusedAddress(false);
      let receiveAddress: string;
      if (unused) {
        receiveAddress = unused.address;
      } else {
        const derived = keyManager.getNextAddress();
        await database.insertAddress(
          derived.address,
          derived.path,
          derived.index,
          false,
        );
        receiveAddress = derived.address;
        addressList.push(derived.address);
      }

      // Load wallet info
      const activeId = walletId ?? await getActiveWalletId();
      const wallets = await getWalletIndex();
      const activeWallet = activeId
        ? wallets.find((w) => w.id === activeId)
        : undefined;

      // Check if this is a watch-only wallet
      const watchOnly = activeId ? await checkIsWatchOnly(activeId) : false;

      set({
        initialized: true,
        loading: false,
        currentReceiveAddress: receiveAddress,
        addresses: addressList,
        balance: utxoSet.getBalance(),
        confirmedBalance: utxoSet.getConfirmedBalance(),
        unconfirmedBalance: utxoSet.getUnconfirmedBalance(),
        activeWalletId: activeId,
        activeWalletName: activeWallet?.name ?? "",
        wallets,
        isWatchOnly: watchOnly,
      });

      // Start SPV client for P2P connectivity
      try {
        set({ networkStatus: "Resolving DNS seeds..." });
        const socketProvider = createSocketProvider();
        const headerStore = new DatabaseHeaderStore(database);

        spvClient = new SPVClient({
          network: networkConfig,
          socketProvider,
          headerStore,
        });

        spvClient.setEvents({
          onTransaction: (tx, txid, blockHash) => {
            // A peer delivered a transaction matching our Bloom filter.
            // Process it: credit received outputs, debit spent inputs, and
            // persist everything so balances survive restarts. The SPV client
            // calls this synchronously, so fire the async processor and route
            // any failure into the store's error state (never swallow it).
            void processIncomingTransaction(tx, txid, blockHash, set, get).catch(
              (err: unknown) => {
                const message =
                  err instanceof Error ? err.message : "Unknown error";
                set({ error: `Failed to process transaction: ${message}` });
              },
            );
          },
          onBlockHeader: (header) => {
            set({ chainHeight: header.height });
            // A new tip means previously-received UTXOs gained a confirmation.
            void reconcileConfirmations(set, get).catch(() => {
              // Confirmation reconciliation is best-effort; a transient failure
              // here is retried on the next block. Do not surface it as a
              // wallet error or interrupt sync.
            });
          },
          onReorg: async (forkHeight) => {
            // A longer chain orphaned the blocks above forkHeight. Roll the
            // wallet (UTXO set, balance, tx list) back so it never spends or
            // displays outputs that no longer exist on the winning chain. This
            // runs before the SPV client stores the new branch.
            await rewindWalletToHeight(forkHeight, set);
          },
          onSyncProgress: (progress) => {
            set({
              syncProgress: Math.round(progress * 100),
              isSyncing: progress < 1,
            });
            // Once headers are (nearly) caught up, kick the historical rescan
            // so funds received before the filter loaded are discovered. The
            // driver is guarded and resumable, so calling it repeatedly is safe.
            if (progress >= 1) {
              void runHistoricalRescan(set, get).catch(() => {
                // Rescan is best-effort; failures are retried on the next tip
                // advance and do not surface as wallet errors.
              });
            }
          },
        });

        // Load Bloom filter with all wallet addresses
        if (keyManager) {
          const allAddresses = keyManager.getAllAddresses();
          const addressHashes = allAddresses.map((addr) => {
            const decoded = decodeAddress(addr);
            return decoded.hash;
          });
          spvClient.setBloomFilter(addressHashes);
        }

        set({ networkStatus: "Connecting to peers..." });
        await spvClient.start();

        set({
          chainHeight: spvClient.getChainHeight(),
          networkStatus: "Waiting for peers...",
        });

        // Periodic peer count updater
        const peerUpdateInterval = setInterval(() => {
          if (!spvClient) {
            clearInterval(peerUpdateInterval);
            return;
          }
          const count = spvClient.getPeerManager().getReadyPeers().length;
          set({
            connectedPeers: count,
            networkStatus: count > 0
              ? `Connected to ${count} peer${count === 1 ? "" : "s"}`
              : "Searching for peers...",
          });

          // Drive the historical rescan once peers and a chain exist. This
          // covers the already-synced case (a restored wallet whose headers are
          // current so `onSyncProgress` never fires). Guarded + resumable, so
          // the repeated call is a cheap no-op while a scan is in flight or done.
          if (count > 0) {
            void runHistoricalRescan(set, get).catch(() => {
              // Best-effort; retried on the next interval tick.
            });
          }
        }, 5000);
      } catch (spvError: unknown) {
        const spvMsg = spvError instanceof Error ? spvError.message : "Unknown P2P error";
        set({ networkStatus: `P2P error: ${spvMsg}` });
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unknown initialization error";
      set({ loading: false, error: message });
    }
  },

  createWallet: async (): Promise<string> => {
    set({ loading: true, error: null });

    try {
      const mnemonic = await get().createNewWallet("Wallet 1");
      return mnemonic;
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to create wallet";
      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  restoreWallet: async (mnemonic: string): Promise<void> => {
    set({ loading: true, error: null });

    try {
      const trimmed = mnemonic.trim().toLowerCase();
      if (!validateMnemonic(trimmed)) {
        throw new Error("Invalid mnemonic phrase");
      }

      const walletId = generateWalletId();
      const wallets = await getWalletIndex();
      const walletName = `Wallet ${wallets.length + 1}`;

      await saveWalletMnemonic(walletId, trimmed);
      await addWalletToIndex(walletId, walletName);
      await setActiveWalletId(walletId);

      await get().initialize(trimmed, walletId);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to restore wallet";
      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  rescanWallet: async (): Promise<void> => {
    if (!database || !spvClient) {
      return;
    }
    // Force a full rescan from genesis by clearing any persisted progress, then
    // drive it. Discovered transactions are credited idempotently, so this is
    // safe to invoke even if the wallet is already up to date.
    const tip = get().chainHeight;
    await database.saveRescanState({
      start_height: 0,
      next_height: 0,
      target_height: tip > 0 ? tip : 0,
      completed: 0,
    });
    await runHistoricalRescan(set, get);
  },

  refreshBalance: (): void => {
    if (!utxoSet) {
      return;
    }
    set({
      balance: utxoSet.getBalance(),
      confirmedBalance: utxoSet.getConfirmedBalance(),
      unconfirmedBalance: utxoSet.getUnconfirmedBalance(),
    });
  },

  getNewAddress: (): string => {
    if (!keyManager) {
      throw new Error("Wallet not initialized");
    }

    const derived = keyManager.getNextAddress();

    // Persist to database asynchronously
    if (database) {
      database
        .insertAddress(derived.address, derived.path, derived.index, false)
        .catch((err: unknown) => {
          const message =
            err instanceof Error ? err.message : "Unknown database error";
          set({ error: `Failed to persist address: ${message}` });
        });
    }

    const current = get().addresses;
    set({
      currentReceiveAddress: derived.address,
      addresses: [...current, derived.address],
    });

    return derived.address;
  },

  getBuyDeliveryAddress: async (): Promise<string> => {
    if (!keyManager) {
      throw new Error("Wallet not initialized");
    }
    if (keyManager.isWatchOnly()) {
      throw new Error("Watch-only wallet cannot receive bought FAIR");
    }

    // Bought FAIR is delivered to a NORMAL chain-0 receive address, so it flows
    // through the wallet's existing watched-address path: it is in the Bloom
    // filter and accepted by ownsAddress, which a dedicated chain-2 "buy" chain
    // was NOT (review finding C5 — deposits to chain 2 never matched and were
    // rejected). We derive a fresh address per order to keep orders unlinkable.
    const derived = keyManager.getNextAddress();

    if (database) {
      await database.insertAddress(
        derived.address,
        derived.path,
        derived.index,
        false,
      );
    }

    const current = get().addresses;
    set({ addresses: [...current, derived.address] });

    // Make sure the new address is watched before the deposit can arrive.
    // getNextAddress extends the lookahead window; refresh the Bloom filter so
    // a peer relays the incoming transaction that pays this address.
    if (spvClient) {
      const addressHashes = keyManager
        .getAllAddresses()
        .map((addr) => decodeAddress(addr).hash);
      spvClient.setBloomFilter(addressHashes);
    }

    return derived.address;
  },

  sendTransaction: async (
    toAddress: string,
    amount: bigint,
    feeRate: number,
  ): Promise<string> => {
    set({ loading: true, error: null });

    try {
      if (!keyManager || !database || !networkConfig) {
        throw new Error("Wallet not initialized");
      }
      if (get().isWatchOnly) {
        throw new Error("Watch-only wallets cannot send transactions");
      }

      // Build the pool of spendable coins from CONFIRMED unspent rows only.
      // Unconfirmed (block_height < 0, mempool) outputs are excluded so a send
      // never spends funds that could still be reorged away.
      const utxoRows = await database.getUnspentUTXOs();
      const candidates: UTXO[] = utxoRows.map((row) => ({
        txid: row.txid,
        vout: row.vout,
        address: row.address,
        value: BigInt(row.value),
        scriptPubKey: hexToBytes(row.script_pub_key),
        blockHeight: row.block_height,
        confirmed: row.block_height >= 0,
      }));

      // Decide which coins to spend: honour an explicit coin-control selection
      // when present, otherwise pick the minimum set largest-first. This is the
      // single source of truth for spent inputs and the real fee.
      const coinControl = get().selectedUTXOs;
      const selection = selectInputsForSend({
        candidates,
        targetValue: amount,
        feePerByte: feeRate,
        coinControl,
        dustThreshold: networkConfig.minRelayFee,
      });

      const inputs: TxUTXO[] = selection.selected.map((utxo) => ({
        txid: utxo.txid,
        vout: utxo.vout,
        value: utxo.value,
        scriptPubKey: utxo.scriptPubKey,
      }));

      // Build unsigned transaction from EXACTLY the selected inputs. The core
      // builder spends every input it is given, which is why selection (not the
      // builder) is responsible for choosing the right coins.
      const changeAddress = keyManager.getNextChangeAddress().address;
      const tx = buildTransaction({
        utxos: inputs,
        recipients: [{ address: toAddress, value: amount }],
        changeAddress,
        feePerByte: BigInt(feeRate),
        network: networkConfig,
      });

      // Sign each input with the corresponding private key
      for (let i = 0; i < tx.inputs.length; i++) {
        const input = tx.inputs[i];
        const utxo = selection.selected.find(
          (u) => u.txid === input.txid && u.vout === input.vout,
        );
        if (!utxo) {
          throw new Error(`UTXO not found for input ${input.txid}:${input.vout}`);
        }

        const privateKey = keyManager.getPrivateKeyForAddress(utxo.address);
        tx.inputs[i] = {
          ...tx.inputs[i],
          scriptSig: signInput(tx, i, utxo.scriptPubKey, privateKey),
        };
      }

      // Serialize and compute txid
      const rawTx = serializeTransaction(tx);
      const txid = hashTransaction(tx);

      // Broadcast via SPV client (P2P) or log for manual broadcast
      if (spvClient) {
        spvClient.broadcastTransaction(rawTx);
      }

      // Mark UTXOs as spent locally. The spend is unconfirmed (height -1) until
      // it lands in a block; recording the spending txid lets a reorg undo it.
      for (const input of tx.inputs) {
        await database.markUTXOSpent(input.txid, input.vout, txid, -1);
        if (utxoSet) {
          utxoSet.spend(input.txid, input.vout);
        }
      }

      // Persist the transaction record
      const now = Math.floor(Date.now() / 1000);
      await database.insertTransaction({
        txid,
        raw_hex: bytesToHex(rawTx),
        block_height: -1,
        block_hash: "",
        timestamp: now,
        fee: Number(BigInt(feeRate) * BigInt(rawTx.length)),
        confirmed: 0,
      });

      // Update UI state
      const newTx: WalletTransaction = {
        txid,
        amount: -amount,
        address: toAddress,
        timestamp: now,
        confirmations: 0,
        type: "send",
      };

      set((state) => ({
        transactions: [newTx, ...state.transactions],
        loading: false,
        // A coin-control selection is a one-shot instruction for THIS send.
        // Clear it so the next transaction defaults back to automatic
        // selection instead of silently reusing the same (now-spent) coins.
        selectedUTXOs: [],
      }));

      // Refresh balance from UTXO set
      get().refreshBalance();

      return txid;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Transaction failed";
      set({ loading: false, error: msg });
      throw new Error(msg);
    }
  },

  refreshMasternodeUTXOs: (): void => {
    if (!utxoSet) {
      return;
    }

    const state = get();
    const mnUtxos = utxoSet.getMasternodeUTXOs();
    const masternodeList: MasternodeUTXO[] = mnUtxos.map((u) => ({
      txid: u.txid,
      vout: u.vout,
      address: u.address,
      confirmations:
        state.chainHeight > 0 && u.blockHeight > 0
          ? state.chainHeight - u.blockHeight + 1
          : 0,
    }));

    set({ masternodeUTXOs: masternodeList });
  },

  estimateFee: (feeLevel: FeeLevel): bigint => {
    const rate = FEE_RATES[feeLevel];
    return BigInt(rate * AVERAGE_TX_SIZE);
  },

  estimateSend: (amount: bigint, feeRate: number): SendEstimate => {
    // Reason over the same confirmed coins (and coin-control selection) that
    // sendTransaction will spend, so the confirmation screen, the Max button,
    // and the insufficient-funds gate all reflect the REAL fee and balance.
    const candidates: UTXO[] = utxoSet
      ? utxoSet.getAllUTXOs().filter((u) => u.confirmed)
      : [];
    return computeSendEstimate({
      candidates,
      targetValue: amount,
      feePerByte: feeRate,
      coinControl: get().selectedUTXOs,
      dustThreshold: networkConfig?.minRelayFee,
    });
  },

  hasWallet: async (): Promise<boolean> => {
    try {
      const stored = await getMnemonic();
      return stored !== null && stored.length > 0;
    } catch {
      // Secure store may be unavailable (e.g. app just installed,
      // keychain locked). Treat as no wallet present.
      return false;
    }
  },

  wipeWallet: async (): Promise<void> => {
    set({ loading: true, error: null });
    try {
      await clearSecureStore();

      if (database) {
        await database.close();
      }

      resetWalletInternals();

      set({
        ...DEFAULT_WALLET_STATE,
        network: "mainnet",
        activeWalletId: null,
        activeWalletName: "",
        wallets: [],
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to wipe wallet";
      set({ loading: false, error: message });
    }
  },

  // -------------------------------------------------------------------
  // Multi-wallet actions
  // -------------------------------------------------------------------

  loadWalletList: async (): Promise<void> => {
    try {
      const wallets = await getWalletIndex();
      const activeId = await getActiveWalletId();
      const activeWallet = activeId
        ? wallets.find((w) => w.id === activeId)
        : undefined;

      set({
        wallets,
        activeWalletId: activeId,
        activeWalletName: activeWallet?.name ?? "",
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to load wallet list";
      set({ error: message });
    }
  },

  switchWallet: async (walletId: string): Promise<void> => {
    const state = get();
    if (state.activeWalletId === walletId) return;

    set({ loading: true, error: null });

    try {
      // Close current database
      if (database) {
        await database.close();
      }

      // Reset in-memory state
      resetWalletInternals();

      set({
        ...DEFAULT_WALLET_STATE,
        network: state.network,
        activeWalletId: walletId,
        wallets: state.wallets,
        loading: true,
      });

      // Set the new active wallet
      await setActiveWalletId(walletId);

      // Load the new wallet's mnemonic
      const mnemonic = await getWalletMnemonic(walletId);
      if (!mnemonic) {
        throw new Error("Wallet mnemonic not found");
      }

      // Re-initialize with the new wallet
      await get().initialize(mnemonic, walletId);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to switch wallet";
      set({ loading: false, error: message });
    }
  },

  createNewWallet: async (name: string): Promise<string> => {
    set({ loading: true, error: null });

    try {
      const walletId = generateWalletId();
      const mnemonic = generateMnemonic();

      // Save wallet mnemonic with wallet-specific key
      await saveWalletMnemonic(walletId, mnemonic);
      await addWalletToIndex(walletId, name);
      await setActiveWalletId(walletId);

      // Close current database if open
      if (database) {
        await database.close();
      }

      // Reset in-memory state
      resetWalletInternals();

      const state = get();
      set({
        ...DEFAULT_WALLET_STATE,
        network: state.network,
        activeWalletId: walletId,
        activeWalletName: name,
        wallets: state.wallets,
        loading: true,
      });

      // Mark wallet as created in secure store
      await saveMnemonic(mnemonic);

      // Initialize with the new wallet
      await get().initialize(mnemonic, walletId);

      // Reload wallet list
      await get().loadWalletList();

      return mnemonic;
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to create new wallet";
      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  importWallet: async (name: string, mnemonic: string): Promise<void> => {
    set({ loading: true, error: null });

    try {
      const trimmed = mnemonic.trim().toLowerCase();
      if (!validateMnemonic(trimmed)) {
        throw new Error("Invalid mnemonic phrase");
      }

      const walletId = generateWalletId();

      await saveWalletMnemonic(walletId, trimmed);
      await addWalletToIndex(walletId, name);
      await setActiveWalletId(walletId);

      // Close current database if open
      if (database) {
        await database.close();
      }

      resetWalletInternals();

      const state = get();
      set({
        ...DEFAULT_WALLET_STATE,
        network: state.network,
        activeWalletId: walletId,
        activeWalletName: name,
        wallets: state.wallets,
        loading: true,
      });

      await get().initialize(trimmed, walletId);
      await get().loadWalletList();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to import wallet";
      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  deleteWallet: async (walletId: string): Promise<void> => {
    set({ loading: true, error: null });

    try {
      const state = get();
      const isActive = state.activeWalletId === walletId;

      // Remove from index and delete mnemonic
      await removeWalletFromIndex(walletId);
      await deleteWalletMnemonic(walletId);

      // Reload wallet list
      const remainingWallets = await getWalletIndex();

      if (isActive) {
        // Close current database
        if (database) {
          await database.close();
        }
        resetWalletInternals();

        if (remainingWallets.length > 0) {
          // Switch to the first remaining wallet
          const nextWallet = remainingWallets[0];

          set({
            ...DEFAULT_WALLET_STATE,
            network: state.network,
            activeWalletId: nextWallet.id,
            activeWalletName: nextWallet.name,
            wallets: remainingWallets,
            loading: true,
          });

          await setActiveWalletId(nextWallet.id);
          const mnemonic = await getWalletMnemonic(nextWallet.id);
          if (mnemonic) {
            await get().initialize(mnemonic, nextWallet.id);
          }
        } else {
          // No wallets left - go to onboarding state
          set({
            ...DEFAULT_WALLET_STATE,
            network: state.network,
            activeWalletId: null,
            activeWalletName: "",
            wallets: [],
          });
        }
      } else {
        // Not the active wallet, just update the list
        set({
          wallets: remainingWallets,
          loading: false,
        });
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to delete wallet";
      set({ loading: false, error: message });
    }
  },

  renameActiveWallet: async (name: string): Promise<void> => {
    const state = get();
    if (!state.activeWalletId) return;

    try {
      await renameWallet(state.activeWalletId, name);
      const wallets = await getWalletIndex();
      set({
        activeWalletName: name,
        wallets,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to rename wallet";
      set({ error: message });
    }
  },

  // -------------------------------------------------------------------
  // Watch-only wallet import
  // -------------------------------------------------------------------

  importWatchOnly: async (name: string, xpub: string): Promise<void> => {
    set({ loading: true, error: null });

    try {
      const trimmedXpub = xpub.trim();

      // Validate the extended public key BEFORE persisting anything. This both
      // gives the user a clear error on a bad key and guarantees we never store
      // a non-mnemonic that could later be (mis)fed into seed derivation.
      // KeyManager.fromXpub throws on anything that isn't a valid xpub for this
      // network (or that carries private material).
      const network = getNetwork(get().network);
      KeyManager.fromXpub(trimmedXpub, network);

      const walletId = generateWalletId();

      // Persist the xpub both as the watch-only flag (saveWalletXpub) and as the
      // wallet "secret" using the xpub: marker. `initialize` routes the marker
      // to the public-only KeyManager (no private keys).
      await saveWalletXpub(walletId, trimmedXpub);
      await addWalletToIndex(walletId, name);
      await saveWalletMnemonic(walletId, `${XPUB_MARKER_PREFIX}${trimmedXpub}`);
      await setActiveWalletId(walletId);

      // Close current database if open
      if (database) {
        await database.close();
      }

      resetWalletInternals();

      const state = get();
      set({
        ...DEFAULT_WALLET_STATE,
        network: state.network,
        activeWalletId: walletId,
        activeWalletName: name,
        wallets: state.wallets,
        isWatchOnly: true,
        loading: true,
      });

      // Initialize like any other wallet: derive watch addresses, persist them,
      // load the Bloom filter, and start SPV so balances actually appear.
      await get().initialize(`${XPUB_MARKER_PREFIX}${trimmedXpub}`, walletId);
      await get().loadWalletList();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to import watch-only wallet";
      set({ loading: false, error: message });
      throw new Error(message);
    }
  },

  // -------------------------------------------------------------------
  // Network switching
  // -------------------------------------------------------------------

  switchNetwork: async (newNetwork: NetworkType): Promise<void> => {
    const state = get();
    if (state.network === newNetwork) return;

    set({ loading: true, error: null });

    try {
      // Stop SPV client
      resetWalletInternals();

      // Close current database
      if (database) {
        await database.close();
      }

      // Reset to uninitialized state with new network
      set({
        ...DEFAULT_WALLET_STATE,
        network: newNetwork,
        activeWalletId: state.activeWalletId,
        activeWalletName: state.activeWalletName,
        wallets: state.wallets,
        initialized: false,
        loading: true,
      });

      // Re-initialize with the current wallet's mnemonic on the new network
      if (state.activeWalletId) {
        const mnemonic = await getWalletMnemonic(state.activeWalletId);
        if (mnemonic) {
          await get().initialize(mnemonic, state.activeWalletId);
        } else {
          set({ loading: false });
        }
      } else {
        set({ loading: false });
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to switch network";
      set({ loading: false, error: message });
    }
  },

  // -------------------------------------------------------------------
  // Backup export/import
  // -------------------------------------------------------------------

  exportBackup: async (): Promise<string> => {
    if (!database) {
      throw new Error("Wallet not initialized");
    }

    try {
      const contacts = await database.getContacts();
      const addresses = await database.getAddresses();

      // Collect address labels and tx notes
      const addressLabels: Array<{ address: string; label: string }> = [];
      for (const addr of addresses) {
        const label = await database.getAddressLabel(addr.address);
        if (label) {
          addressLabels.push({ address: addr.address, label });
        }
      }

      const backup = {
        version: 1,
        exportedAt: Date.now(),
        contacts: contacts.map((c) => ({
          name: c.name,
          address: c.address,
          notes: c.notes,
        })),
        addressLabels,
      };

      return JSON.stringify(backup, null, 2);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to export backup";
      throw new Error(message);
    }
  },

  importBackup: async (json: string): Promise<void> => {
    if (!database) {
      throw new Error("Wallet not initialized");
    }

    try {
      const backup = JSON.parse(json) as {
        version?: number;
        contacts?: Array<{
          name: string;
          address: string;
          notes: string;
        }>;
        addressLabels?: Array<{ address: string; label: string }>;
      };

      if (typeof backup.version !== "number") {
        throw new Error("Invalid backup format: missing version");
      }

      // Import contacts
      if (Array.isArray(backup.contacts)) {
        for (const contact of backup.contacts) {
          const id = generateWalletId(); // reuse UUID generator
          await database.insertContact(
            id,
            contact.name,
            contact.address,
            contact.notes,
          );
        }
      }

      // Import address labels
      if (Array.isArray(backup.addressLabels)) {
        for (const label of backup.addressLabels) {
          await database.setAddressLabel(label.address, label.label);
        }
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to import backup";
      throw new Error(message);
    }
  },

  // -------------------------------------------------------------------
  // Coin control
  // -------------------------------------------------------------------

  setSelectedUTXOs: (utxos: Array<{ txid: string; vout: number }>): void => {
    set({ selectedUTXOs: utxos });
  },

  clearSelectedUTXOs: (): void => {
    set({ selectedUTXOs: [] });
  },
}));

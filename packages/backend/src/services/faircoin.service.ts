/**
 * LIVE FairCoin on-chain integration — the boundary between Oxy Pay's custodial
 * ledger and the FairCoin network. THIS HANDLES REAL ON-CHAIN MONEY.
 *
 * Mode selection:
 * - Mock mode (default): `isLive()` is false when either the RPC password or the
 *   master mnemonic is absent. `getDepositAddress` returns an in-memory fake
 *   address and `estimateWithdrawalFee` returns a flat quote; `broadcastWithdrawal`
 *   refuses (503) — a withdrawal is never faked.
 * - Live mode: both `FAIRCOIN_RPC_PASS` and `FAIRCOIN_MASTER_MNEMONIC` are set.
 *   Deposit addresses are BIP44-derived (account=0, change=0, index=n), watched
 *   by the node (`importaddress`) and credited by the poller; withdrawals select
 *   coins, build/sign/serialize a transaction and broadcast it.
 *
 * Money is BigInt in base units everywhere on-chain; `Money` strings are only
 * constructed at the `creditWallet` boundary. FAIR has 8 decimals.
 *
 * SENSITIVE: the master mnemonic and RPC password are read from the environment
 * and are NEVER logged, returned, or embedded in error messages.
 */

import { customAlphabet } from 'nanoid';
import {
  MAINNET,
  TESTNET,
  type NetworkConfig,
  validateMnemonic,
  mnemonicToSeed,
  deriveAddress,
  validateAddress,
  decodeAddress,
  createP2PKHScript,
  bytesToHex,
  buildTransaction,
  estimateTxSize,
  signInput,
  serializeTransaction,
  type UTXO,
  type Transaction,
} from '@fairco.in/core';
import { HttpError } from '../middleware/errorHandler';
import { newFaircoinAddressId } from '../utils/ids';
import { FaircoinAddress } from '../models/FaircoinAddress';
import { Counter } from '../models/Counter';
import { FaircoinWatcherState } from '../models/FaircoinWatcherState';
import { Transaction as LedgerTransaction } from '../models/Transaction';
import { creditWallet } from './wallet.service';
import {
  getRpcClient,
  hasRpcConfig,
  type EstimateSmartFeeResult,
  type ListUnspentItem,
  type ListSinceBlockResult,
} from './faircoinRpc';
import {
  fairToBaseUnits,
  convertFeerateToFeePerByte,
  selectUtxos,
  buildExternalRef,
  type SelectableUtxo,
} from './faircoinMath';

// --- Constants (no magic numbers/strings) -----------------------------------

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const fakeAddress = customAlphabet(BASE58, 34);

/** Fixed BIP44 derivation for custodial deposit addresses. */
const FAIRCOIN_BIP44_ACCOUNT = 0;
const FAIRCOIN_BIP44_CHANGE = 0;
/** Reserved hot-wallet change branch/index (change=1, index=0). */
const FAIRCOIN_BIP44_CHANGE_BRANCH = 1;
const FAIRCOIN_BIP44_CHANGE_INDEX = 0;

/** Atomic derivation-index allocator id. */
const DERIVATION_INDEX_COUNTER_ID = 'faircoin_derivation_index';
/** Single-doc watcher-state id. */
const WATCHER_STATE_ID = 'faircoin_watcher_state';

/** Confirmation target passed to `estimatesmartfee`. */
const FAIRCOIN_FEE_CONF_TARGET = 6;
/** Default required confirmations before crediting / spending. */
const DEFAULT_MIN_CONFIRMATIONS = 6;
/** Default watcher poll interval (ms). */
const DEFAULT_WATCHER_INTERVAL_MS = 60_000;
/** Documented fallback feerate (base units per byte) when estimatesmartfee is unavailable. */
const DEFAULT_FALLBACK_FEERATE_SATS_PER_BYTE = 10n;
/** Typical input count used for a withdrawal fee quote. */
const FAIRCOIN_TYPICAL_INPUTS = 2;
/** A withdrawal always has recipient + change outputs. */
const WITHDRAWAL_NUM_OUTPUTS = 2;
/** `listunspent` upper confirmation bound (effectively unbounded). */
const LISTUNSPENT_MAX_CONF = 9_999_999;
/** Mock-mode flat fee quote (base units = 0.001 FAIR). */
const MOCK_FEE_BASE_UNITS = '100000';

/**
 * Pre-broadcast sanity cap: reject any transaction whose implied fee exceeds
 * this many base units (1 FAIR). A fee this large signals a coin-selection or
 * change-computation bug; refusing protects custodial funds. Documented as a
 * review point — tune if legitimate high-fee conditions ever arise.
 */
const MAX_REASONABLE_FEE_BASE_UNITS = 100_000_000n;

// --- Types ------------------------------------------------------------------

export interface FairCoinDepositAddress {
  /** FairCoin address (P2PKH). */
  address: string;
  /** ISO date string at which this address was issued. */
  issuedAt: string;
}

/** A spendable custodial coin enriched with the key material needed to sign it. */
interface SpendableUtxo extends SelectableUtxo {
  scriptPubKey: Uint8Array;
  privateKey: Uint8Array;
}

const inMemoryAddresses = new Map<string, FairCoinDepositAddress>();

// --- Environment helpers ----------------------------------------------------

function getNetwork(): NetworkConfig {
  return process.env.FAIRCOIN_NETWORK === 'testnet' ? TESTNET : MAINNET;
}

function getMinConfirmations(): number {
  const parsed = Number.parseInt(process.env.FAIRCOIN_MIN_CONFIRMATIONS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MIN_CONFIRMATIONS;
}

function getWatcherIntervalMs(): number {
  const parsed = Number.parseInt(process.env.FAIRCOIN_WATCHER_INTERVAL_MS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WATCHER_INTERVAL_MS;
}

function getFallbackFeePerByte(): bigint {
  const raw = process.env.FAIRCOIN_FALLBACK_FEERATE_SATS_PER_BYTE;
  if (!raw) return DEFAULT_FALLBACK_FEERATE_SATS_PER_BYTE;
  if (!/^\d+$/.test(raw)) return DEFAULT_FALLBACK_FEERATE_SATS_PER_BYTE;
  const parsed = BigInt(raw);
  return parsed > 0n ? parsed : DEFAULT_FALLBACK_FEERATE_SATS_PER_BYTE;
}

/**
 * Live when BOTH the RPC password and a master mnemonic are configured. Either
 * one missing keeps the service in mock mode.
 */
export function isLive(): boolean {
  return hasRpcConfig() && Boolean(process.env.FAIRCOIN_MASTER_MNEMONIC);
}

// --- Master seed (lazy, cached) ---------------------------------------------

let cachedSeed: Uint8Array | null = null;

/**
 * Resolve and cache the master HD seed from `FAIRCOIN_MASTER_MNEMONIC`. The
 * mnemonic is validated on first use and is never logged or returned. The seed
 * (not the mnemonic) is cached so the secret phrase is not retained.
 */
function getMasterSeed(): Uint8Array {
  if (cachedSeed) return cachedSeed;
  const mnemonic = process.env.FAIRCOIN_MASTER_MNEMONIC;
  if (!mnemonic) {
    throw new HttpError(503, 'faircoin_not_configured', 'FairCoin master mnemonic is not configured');
  }
  if (!validateMnemonic(mnemonic)) {
    // Do NOT include the mnemonic in the error.
    throw new HttpError(500, 'faircoin_invalid_mnemonic', 'FairCoin master mnemonic is invalid');
  }
  cachedSeed = mnemonicToSeed(mnemonic);
  return cachedSeed;
}

// --- RPC helpers ------------------------------------------------------------

/**
 * Tell the node to watch an address. `rescan=false` (a rescan would be slow and
 * is unnecessary for a freshly-derived address). Re-importing an already-known
 * address is swallowed; any other failure is rethrown so the caller can refuse
 * to hand out an unwatched address.
 */
async function importAddress(address: string, label: string): Promise<void> {
  try {
    await getRpcClient().call<null>('importaddress', [address, label, false]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/already/i.test(message)) {
      console.warn('[oxypay][faircoin] importaddress: address already imported, continuing');
      return;
    }
    throw err;
  }
}

/** Resolve the per-byte fee from the node, falling back to the configured default. */
async function getFeePerByte(): Promise<bigint> {
  try {
    const result = await getRpcClient().call<EstimateSmartFeeResult>('estimatesmartfee', [
      FAIRCOIN_FEE_CONF_TARGET,
    ]);
    if (typeof result.feerate === 'number' && result.feerate > 0) {
      const feePerByte = convertFeerateToFeePerByte(String(result.feerate));
      if (feePerByte && feePerByte > 0n) return feePerByte;
    }
  } catch (err) {
    console.error('[oxypay][faircoin] estimatesmartfee failed, using fallback feerate:', err);
  }
  return getFallbackFeePerByte();
}

// --- Public service methods -------------------------------------------------

/**
 * Returns a deposit address for the user. Reuses the previously-issued address.
 * Mock mode returns a deterministic in-process address. Live mode derives a
 * fresh HD address, validates it, registers it with the node, then persists it.
 *
 * Order is: allocate index -> derive -> validate -> importaddress -> persist.
 * If importaddress fails for an unexpected reason we do NOT persist, so the
 * mapping table only ever contains node-watched addresses (a skipped counter
 * index is acceptable — gaps are fine).
 */
export async function getDepositAddress(userId: string): Promise<FairCoinDepositAddress> {
  if (!isLive()) {
    const cached = inMemoryAddresses.get(userId);
    if (cached) return cached;
    const addr = { address: `f${fakeAddress()}`, issuedAt: new Date().toISOString() };
    inMemoryAddresses.set(userId, addr);
    return addr;
  }

  const existing = await FaircoinAddress.findOne({ userId });
  if (existing) {
    return { address: existing.address, issuedAt: existing.createdAt.toISOString() };
  }

  const network = getNetwork();
  const seed = getMasterSeed();

  // Atomic, collision-free index allocation.
  const counter = await Counter.findByIdAndUpdate(
    DERIVATION_INDEX_COUNTER_ID,
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  if (!counter) {
    throw new HttpError(500, 'faircoin_derivation_failed', 'Failed to allocate derivation index');
  }
  const derivationIndex = counter.seq;

  const derived = deriveAddress(seed, FAIRCOIN_BIP44_ACCOUNT, FAIRCOIN_BIP44_CHANGE, derivationIndex, network);
  if (!validateAddress(derived.address, network)) {
    throw new HttpError(500, 'faircoin_derivation_failed', 'Derived an invalid FairCoin address');
  }

  // Register with the node BEFORE persisting so the mapping only holds watched
  // addresses. importAddress rethrows unexpected failures.
  try {
    await importAddress(derived.address, userId);
  } catch (err) {
    console.error('[oxypay][faircoin] importaddress failed:', err);
    throw new HttpError(502, 'faircoin_node_error', 'Failed to register deposit address with the node');
  }

  // Persist. `userId` is unique, so a concurrent racer that already persisted
  // wins and we return the existing mapping rather than creating a duplicate.
  try {
    const doc = await FaircoinAddress.create({
      _id: newFaircoinAddressId(),
      userId,
      address: derived.address,
      derivationIndex,
    });
    return { address: doc.address, issuedAt: doc.createdAt.toISOString() };
  } catch (err) {
    const raced = await FaircoinAddress.findOne({ userId });
    if (raced) {
      return { address: raced.address, issuedAt: raced.createdAt.toISOString() };
    }
    console.error('[oxypay][faircoin] failed to persist deposit address mapping:', err);
    throw new HttpError(500, 'faircoin_persist_failed', 'Failed to persist deposit address');
  }
}

/**
 * Estimate the network fee for a withdrawal. Returns a fee quote in FAIR base
 * units (string). Mock mode returns a flat quote.
 *
 * Live: feerate from `estimatesmartfee` -> base-units-per-byte (ceil), then
 * fee = feePerByte * estimateTxSize(typicalInputs, recipient+change).
 */
export async function estimateWithdrawalFee(_amountFair: string): Promise<string> {
  if (!isLive()) return MOCK_FEE_BASE_UNITS;
  const feePerByte = await getFeePerByte();
  const size = BigInt(estimateTxSize(FAIRCOIN_TYPICAL_INPUTS, WITHDRAWAL_NUM_OUTPUTS));
  const fee = feePerByte * size;
  return fee.toString();
}

/**
 * Build, sign, and broadcast a withdrawal of `amountFair` (base units string)
 * to `toAddress`. Mock mode refuses (a real broadcast is never faked).
 *
 * ⚠️ FUND-SAFETY CONTRACT — DO NOT call this directly from a route. It spends
 * from the shared custodial hot wallet and performs NO balance check or debit.
 * It MUST be invoked only by a withdrawal orchestrator that, atomically and
 * idempotently: (1) verifies the user's FAIR balance, (2) `debitWallet(...)`
 * with a stable `paymentId`/withdrawalId, (3) records a pending withdrawal,
 * THEN (4) calls this and reconciles (reverse/refund the debit on broadcast
 * failure). Wiring this to an endpoint without that orchestrator lets any user
 * drain the entire hot wallet. The orchestrator + route are not yet built.
 */
export async function broadcastWithdrawal(toAddress: string, amountFair: string): Promise<{ txid: string }> {
  if (!isLive()) {
    throw new HttpError(503, 'faircoin_not_configured', 'FairCoin RPC integration is not configured');
  }

  const network = getNetwork();
  const seed = getMasterSeed();

  // (a) Validate destination + amount.
  if (!validateAddress(toAddress, network)) {
    throw new HttpError(400, 'invalid_address', 'Invalid FairCoin address');
  }
  if (!/^\d+$/.test(amountFair)) {
    throw new HttpError(400, 'invalid_amount', 'Amount must be a base-units integer string');
  }
  const amount = BigInt(amountFair);
  if (amount <= 0n) {
    throw new HttpError(400, 'invalid_amount', 'Amount must be positive');
  }

  // The fixed reserved hot-wallet change address (account=0, change=1, index=0).
  // Derived up-front so it is included in the spendable set: change produced by
  // earlier withdrawals must be re-spendable, otherwise it accumulates unspent.
  const changeDerived = deriveAddress(
    seed,
    FAIRCOIN_BIP44_ACCOUNT,
    FAIRCOIN_BIP44_CHANGE_BRANCH,
    FAIRCOIN_BIP44_CHANGE_INDEX,
    network
  );
  if (!validateAddress(changeDerived.address, network)) {
    throw new HttpError(500, 'faircoin_tx_invalid', 'Derived an invalid change address');
  }

  // (b) Gather custodial addresses + their key material, then list UTXOs.
  const addressDocs = await FaircoinAddress.find({});

  // address -> { privateKey, scriptPubKey } for every spendable custodial address
  // (all deposit addresses + the reserved change address). The scriptPubKey is
  // derived from the address (deterministic, does not trust node-returned hex)
  // so signing's prevScriptPubKey is guaranteed consistent.
  const keyByAddress = new Map<string, { privateKey: Uint8Array; scriptPubKey: Uint8Array }>();
  const addToKeyMap = (address: string, privateKey: Uint8Array): void => {
    const scriptPubKey = createP2PKHScript(decodeAddress(address).hash);
    keyByAddress.set(address, { privateKey, scriptPubKey });
  };
  for (const doc of addressDocs) {
    const derived = deriveAddress(
      seed,
      FAIRCOIN_BIP44_ACCOUNT,
      FAIRCOIN_BIP44_CHANGE,
      doc.derivationIndex,
      network
    );
    addToKeyMap(doc.address, derived.privateKey);
  }
  addToKeyMap(changeDerived.address, changeDerived.privateKey);

  const minConf = getMinConfirmations();
  const addresses = Array.from(keyByAddress.keys());
  const unspent = await getRpcClient().call<ListUnspentItem[]>('listunspent', [
    minConf,
    LISTUNSPENT_MAX_CONF,
    addresses,
  ]);

  const spendable: SpendableUtxo[] = [];
  for (const item of unspent) {
    if (item.spendable === false) continue;
    const keys = keyByAddress.get(item.address);
    if (!keys) continue; // unknown address (e.g. change) — not part of this set
    const value = fairToBaseUnits(String(item.amount));
    if (value <= 0n) continue;
    spendable.push({
      txid: item.txid,
      vout: item.vout,
      value,
      scriptPubKey: keys.scriptPubKey,
      privateKey: keys.privateKey,
    });
  }

  // (c) Deterministic coin selection with iterative fee.
  const feePerByte = await getFeePerByte();
  let selection;
  try {
    selection = selectUtxos<SpendableUtxo>(
      spendable,
      amount,
      feePerByte,
      WITHDRAWAL_NUM_OUTPUTS,
      estimateTxSize
    );
  } catch (err) {
    if (err instanceof Error && err.message === 'insufficient_funds') {
      throw new HttpError(402, 'insufficient_funds', 'Insufficient hot-wallet funds');
    }
    throw err;
  }

  // (d) Ensure the node watches the reserved change address so the change output
  // of this withdrawal shows up in future listunspent and can be re-spent.
  // importAddress swallows "already imported" and rethrows anything unexpected.
  try {
    await importAddress(changeDerived.address, 'hot-change');
  } catch (err) {
    console.error('[oxypay][faircoin] importaddress (change) failed:', err);
    throw new HttpError(502, 'faircoin_node_error', 'Failed to register change address with the node');
  }

  // (e) Build the transaction (handles change + dust folding, throws on shortfall).
  const utxos: UTXO[] = selection.selected.map((u) => ({
    txid: u.txid,
    vout: u.vout,
    value: u.value,
    scriptPubKey: u.scriptPubKey,
  }));
  let tx: Transaction;
  try {
    tx = buildTransaction({
      utxos,
      recipients: [{ address: toAddress, value: amount }],
      changeAddress: changeDerived.address,
      feePerByte,
      network,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/insufficient funds/i.test(message)) {
      throw new HttpError(402, 'insufficient_funds', 'Insufficient hot-wallet funds');
    }
    console.error('[oxypay][faircoin] buildTransaction failed:', err);
    throw new HttpError(500, 'faircoin_tx_invalid', 'Failed to build withdrawal transaction');
  }

  // (f) Sign every input with its own UTXO scriptPubKey + matching private key.
  // buildTransaction preserves input order, so selection.selected[i] aligns
  // with tx.inputs[i].
  for (let i = 0; i < tx.inputs.length; i++) {
    const source = selection.selected[i];
    if (!source) {
      throw new HttpError(500, 'faircoin_tx_invalid', 'Input/UTXO count mismatch while signing');
    }
    tx.inputs[i].scriptSig = signInput(tx, i, source.scriptPubKey, source.privateKey);
  }

  // (g) Pre-broadcast sanity guard: never broadcast outputs > inputs.
  const totalIn = selection.selected.reduce((acc, u) => acc + u.value, 0n);
  const totalOut = tx.outputs.reduce((acc, o) => acc + o.value, 0n);
  if (totalOut > totalIn) {
    throw new HttpError(500, 'faircoin_tx_invalid', 'Refusing to broadcast: outputs exceed inputs');
  }
  const impliedFee = totalIn - totalOut;
  if (impliedFee < 0n) {
    throw new HttpError(500, 'faircoin_tx_invalid', 'Refusing to broadcast: negative implied fee');
  }
  if (impliedFee > MAX_REASONABLE_FEE_BASE_UNITS) {
    throw new HttpError(500, 'faircoin_tx_invalid', 'Refusing to broadcast: implied fee exceeds sanity cap');
  }

  // (h) Serialize + broadcast.
  const rawHex = bytesToHex(serializeTransaction(tx));
  try {
    const txid = await getRpcClient().call<string>('sendrawtransaction', [rawHex]);
    return { txid };
  } catch (err) {
    // Log the raw node error server-side only; never echo node internals
    // (mempool/fee policy, tx hex) back to the API caller.
    console.error('[oxypay][faircoin] sendrawtransaction failed:', err);
    throw new HttpError(502, 'faircoin_broadcast_failed', 'Broadcast failed');
  }
}

// --- Deposit watcher --------------------------------------------------------

let watcherTimer: ReturnType<typeof setInterval> | null = null;
let scanning = false;

/**
 * One watcher tick: fetch wallet transactions since the last scanned block and
 * credit any newly-confirmed receives to known custodial addresses. Idempotent
 * via the `<txid>:<vout>` external reference. Re-entrancy is guarded.
 *
 * Reorg note (documented for the reviewer): the cursor advances to the
 * `lastblock` returned by `listsinceblock` each tick. A deep reorg could
 * theoretically orphan a block already credited; idempotency prevents double
 * credits, but a credited deposit whose tx is later orphaned would NOT be
 * reversed by this watcher. The MIN_CONFIRMATIONS gate (default 6) makes this
 * extremely unlikely. A maximally-safe variant would keep the cursor a few
 * blocks behind the tip.
 */
async function runWatcherTick(): Promise<void> {
  if (scanning) return;
  scanning = true;
  try {
    const minConf = getMinConfirmations();
    const state = await FaircoinWatcherState.findById(WATCHER_STATE_ID);
    const sinceBlock = state?.lastScannedBlockHash ?? '';
    const includeWatchOnly = true;
    const result = await getRpcClient().call<ListSinceBlockResult>('listsinceblock', [
      sinceBlock,
      minConf,
      includeWatchOnly,
    ]);

    for (const tx of result.transactions) {
      if (tx.category !== 'receive') continue;
      if (tx.confirmations < minConf) continue;
      if (!tx.address) continue;

      const mapping = await FaircoinAddress.findOne({ address: tx.address });
      if (!mapping) continue; // unknown/change address — skip

      const externalRef = buildExternalRef(tx.txid, tx.vout ?? 0);
      const already = await LedgerTransaction.findOne({ externalRef });
      if (already) continue; // idempotent: this output is already credited

      const baseUnits = fairToBaseUnits(String(tx.amount));
      if (baseUnits <= 0n) continue;

      await creditWallet({
        userId: mapping.userId,
        currency: 'FAIR',
        amount: { amount: baseUnits.toString(), currency: 'FAIR' },
        type: 'deposit',
        externalRef,
        note: 'FairCoin deposit',
      });
    }

    await FaircoinWatcherState.findByIdAndUpdate(
      WATCHER_STATE_ID,
      { lastScannedBlockHash: result.lastblock },
      { upsert: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    // Never throw out of the interval callback. Log and retry next tick.
    console.error('[oxypay][faircoin-watcher] tick failed:', err);
  } finally {
    scanning = false;
  }
}

/**
 * Start the deposit watcher. No-op when not live or explicitly disabled via
 * `FAIRCOIN_WATCHER_ENABLED=false`. Safe to call once at boot.
 */
export function startFairCoinWatcher(): void {
  if (!isLive()) return;
  if (process.env.FAIRCOIN_WATCHER_ENABLED === 'false') return;
  if (watcherTimer) return;
  const intervalMs = getWatcherIntervalMs();
  watcherTimer = setInterval(() => {
    void runWatcherTick();
  }, intervalMs);
  // Do not keep the process alive solely for the watcher.
  if (typeof watcherTimer.unref === 'function') watcherTimer.unref();
  console.warn('[oxypay][faircoin-watcher] started');
}

/** Stop the deposit watcher (for clean shutdown / tests). */
export function stopFairCoinWatcher(): void {
  if (watcherTimer) {
    clearInterval(watcherTimer);
    watcherTimer = null;
  }
}

/**
 * FairCoin node integration. This is the boundary between Oxy Pay's custodial
 * ledger and the on-chain FairCoin network.
 *
 * In dev (when `FAIRCOIN_RPC_URL` is not set) this service runs in mock mode:
 * addresses are random base58-looking strings and no chain watcher is started.
 *
 * The deposit address strategy is one fresh address per user (HD-derived),
 * watched by a poller that calls `creditWallet({ type: 'deposit', externalRef:
 * txid })` on each confirmed incoming transaction.
 */

import { customAlphabet } from 'nanoid';
import { HttpError } from '../middleware/errorHandler';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const fakeAddress = customAlphabet(BASE58, 34);

export interface FairCoinDepositAddress {
  /** FairCoin address (P2PKH or P2SH). */
  address: string;
  /** ISO date string at which this address was issued. */
  issuedAt: string;
}

const inMemoryAddresses = new Map<string, FairCoinDepositAddress>();

export function isLive(): boolean {
  return Boolean(process.env.FAIRCOIN_RPC_URL);
}

/**
 * Returns a deposit address for the given user. Reuses the previously-issued
 * address (FairCoin addresses are reusable). Mock mode returns a deterministic
 * in-process address for the user. Live mode is intentionally disabled until a
 * real FairCoin RPC client is wired in; refusing is safer than issuing fake
 * addresses while `FAIRCOIN_RPC_URL` is configured.
 */
export async function getDepositAddress(userId: string): Promise<FairCoinDepositAddress> {
  const cached = inMemoryAddresses.get(userId);
  if (cached) return cached;
  if (!isLive()) {
    const addr = { address: `f${fakeAddress()}`, issuedAt: new Date().toISOString() };
    inMemoryAddresses.set(userId, addr);
    return addr;
  }
  throw new HttpError(
    503,
    'faircoin_not_configured',
    'FairCoin RPC integration is not implemented yet. Set FAIRCOIN_RPC_URL=... and implement getDepositAddress.'
  );
}

/**
 * Estimate the network fee for a FairCoin withdrawal of the given amount.
 * Returns a fee quote in FAIR base units. In mock mode this returns a flat
 * `0.001 FAIR` (100000 base units).
 */
export async function estimateWithdrawalFee(_amountFair: string): Promise<string> {
  if (!isLive()) return '100000';
  throw new HttpError(503, 'faircoin_not_configured', 'FairCoin RPC integration is not implemented yet.');
}

/**
 * Broadcast a withdrawal transaction. Live mode is not implemented yet.
 */
export async function broadcastWithdrawal(
  _toAddress: string,
  _amountFair: string
): Promise<{ txid: string }> {
  throw new HttpError(503, 'faircoin_not_configured', 'FairCoin RPC integration is not implemented yet.');
}

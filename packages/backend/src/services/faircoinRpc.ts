/**
 * Typed JSON-RPC access to the custodial FairCoin node.
 *
 * The client is constructed lazily from environment variables and cached as a
 * module singleton (the client itself is stateless and thread-safe). Result
 * shapes for every RPC method this service calls are declared as explicit
 * interfaces — no `any` ever crosses this boundary.
 *
 * Secrets (`FAIRCOIN_RPC_PASS`) are read from the environment and never logged.
 */
import { FaircoinRpcClient } from '@fairco.in/rpc-client';
import { HttpError } from '../middleware/errorHandler';

const DEFAULT_RPC_HOST = 'seed1.fairco.in';
const DEFAULT_RPC_PORT = '46373';
const DEFAULT_RPC_USER = 'faircoinrpc';
const DEFAULT_RPC_SCHEME = 'http';

let cachedClient: FaircoinRpcClient | null = null;

/**
 * True when the RPC credentials required to reach the node are present. Host,
 * port and user have safe defaults, so the only hard requirement is the
 * password.
 */
export function hasRpcConfig(): boolean {
  return Boolean(process.env.FAIRCOIN_RPC_PASS);
}

/**
 * Lazily construct (and cache) the RPC client from the environment. Throws a
 * non-leaking 503 when the password is absent.
 */
export function getRpcClient(): FaircoinRpcClient {
  if (cachedClient) return cachedClient;
  const rpcPass = process.env.FAIRCOIN_RPC_PASS;
  if (!rpcPass) {
    throw new HttpError(
      503,
      'faircoin_not_configured',
      'FairCoin RPC is not configured (FAIRCOIN_RPC_PASS missing)'
    );
  }
  cachedClient = new FaircoinRpcClient({
    rpcHost: process.env.FAIRCOIN_RPC_HOST || DEFAULT_RPC_HOST,
    rpcPort: process.env.FAIRCOIN_RPC_PORT || DEFAULT_RPC_PORT,
    rpcUser: process.env.FAIRCOIN_RPC_USER || DEFAULT_RPC_USER,
    rpcPass,
    rpcScheme: process.env.FAIRCOIN_RPC_SCHEME || DEFAULT_RPC_SCHEME,
  });
  return cachedClient;
}

/** `estimatesmartfee` result. `feerate` is FAIR per kB; may be absent or <= 0. */
export interface EstimateSmartFeeResult {
  feerate?: number;
  errors?: string[];
  blocks?: number;
}

/** One entry from `listunspent`. `amount` is a FAIR decimal; `scriptPubKey` hex. */
export interface ListUnspentItem {
  txid: string;
  vout: number;
  address: string;
  scriptPubKey: string;
  amount: number;
  confirmations: number;
  spendable?: boolean;
}

/** One transaction entry from `listsinceblock`. `amount` is a FAIR decimal. */
export interface ListSinceBlockTransaction {
  address?: string;
  category: string;
  amount: number;
  confirmations: number;
  txid: string;
  vout?: number;
  blockhash?: string;
}

/** `listsinceblock` result. `lastblock` is the cursor for the next scan. */
export interface ListSinceBlockResult {
  transactions: ListSinceBlockTransaction[];
  lastblock: string;
}

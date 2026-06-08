/**
 * SPV (Simplified Payment Verification) client for FairCoin.
 *
 * Orchestrates header-chain sync, Bloom filter management for address
 * monitoring, Merkle proof validation, and transaction broadcasting.
 */

import { sha256 } from "@noble/hashes/sha256";
import type { NetworkConfig, BlockHeader } from "@fairco.in/core";
import { hashBlockHeader as quarkHashBlockHeader } from "@fairco.in/core";
import { BloomFilter } from "./bloom-filter";
import {
  type BlockHeaderMsg,
  type InvItem,
  type MerkleBlockMsg,
  type ParsedTransaction,
  INV_TX,
  INV_FILTERED_BLOCK,
  parseAddr,
  parseHeaders,
  parseInv,
  parseMerkleBlock,
  parseTx,
  serializeFilterLoad,
  serializeGetData,
  serializeGetHeaders,
} from "./messages";
import type { Peer, SocketProvider } from "./peer";
import { PeerManager, type PeerManagerConfig } from "./peer-manager";
import type { NativeDnsResolver } from "./dns-seeds";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoredBlockHeader {
  hash: Uint8Array; // 32 bytes
  height: number;
  version: number;
  prevBlock: Uint8Array;
  merkleRoot: Uint8Array;
  timestamp: number;
  bits: number;
  nonce: number;
}

export interface HeaderStore {
  getLatestHeader(): Promise<StoredBlockHeader | undefined>;
  getHeaderByHash(hash: Uint8Array): Promise<StoredBlockHeader | undefined>;
  getHeaderByHeight(height: number): Promise<StoredBlockHeader | undefined>;
  saveHeaders(headers: StoredBlockHeader[]): Promise<void>;
  getChainHeight(): Promise<number>;
}

export interface SPVClientConfig {
  network: NetworkConfig;
  socketProvider: SocketProvider;
  headerStore: HeaderStore;
  nativeDnsResolver?: NativeDnsResolver;
}

export interface SPVClientEvents {
  /**
   * Fired for every transaction delivered by a peer that matches the Bloom
   * filter (and for transactions inside matched merkle blocks).
   *
   * @param tx       Parsed transaction (inputs, outputs, raw bytes).
   * @param txid     Transaction id in display byte order (reversed double-SHA256).
   * @param blockHash Hash of the block that contains the tx, in the same byte
   *                  order the header store uses (internal/quark-hash order, as
   *                  produced by `hashBlockHeader`), or `undefined` for an
   *                  unconfirmed (mempool) transaction.
   */
  onTransaction?: (
    tx: ParsedTransaction,
    txid: string,
    blockHash: Uint8Array | undefined,
  ) => void;
  onBlockHeader?: (header: StoredBlockHeader) => void;
  onSyncProgress?: (progress: number) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOCATOR_STEP_MULTIPLIER = 2;
const BLOOM_FALSE_POSITIVE_RATE = 0.0001;

// ---------------------------------------------------------------------------
// Utility: Quark hash of an 80-byte block header (FairCoin uses Quark, not SHA256d)
// ---------------------------------------------------------------------------

function hashBlockHeader(header: BlockHeaderMsg): Uint8Array {
  const coreHeader: BlockHeader = {
    version: header.version,
    prevHash: header.prevBlock,
    merkleRoot: header.merkleRoot,
    timestamp: header.timestamp,
    bits: header.bits,
    nonce: header.nonce,
  };
  return quarkHashBlockHeader(coreHeader);
}

/**
 * Build a block-locator hash list for `getheaders`.
 * Starts from tip and goes back with exponentially increasing steps.
 */
async function buildLocator(store: HeaderStore): Promise<Uint8Array[]> {
  const tip = await store.getChainHeight();
  if (tip <= 0) {
    return [];
  }

  const locator: Uint8Array[] = [];
  let step = 1;
  let height = tip;

  while (height > 0) {
    const header = await store.getHeaderByHeight(height);
    if (header) {
      locator.push(header.hash);
    }

    if (height === 0) {
      break;
    }

    height -= step;
    if (height < 0) {
      height = 0;
    }

    if (locator.length >= 10) {
      step *= LOCATOR_STEP_MULTIPLIER;
    }
  }

  // Always include genesis (height 0)
  const genesis = await store.getHeaderByHeight(0);
  if (genesis) {
    // Only add if not already the last entry
    const last = locator[locator.length - 1];
    if (!last || !bytesEqual(last, genesis.hash)) {
      locator.push(genesis.hash);
    }
  }

  return locator;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Validate a Merkle proof from a merkleblock message.
 * Traverses the partial Merkle tree and checks that the computed root
 * matches the block's merkleRoot.
 */
function validateMerkleProof(merkleBlock: MerkleBlockMsg): Uint8Array[] {
  const { totalTransactions, hashes, flags } = merkleBlock;
  const matchedTxHashes: Uint8Array[] = [];

  if (totalTransactions === 0) {
    return matchedTxHashes;
  }

  // Calculate tree height
  let height = 0;
  let n = totalTransactions;
  while (n > 1) {
    n = Math.ceil(n / 2);
    height++;
  }

  let bitIndex = 0;
  let hashIndex = 0;

  function getBit(): boolean {
    const byteIdx = bitIndex >>> 3;
    const bitIdx = bitIndex & 7;
    bitIndex++;
    if (byteIdx >= flags.length) return false;
    return (flags[byteIdx] & (1 << bitIdx)) !== 0;
  }

  function getHash(): Uint8Array {
    if (hashIndex >= hashes.length) {
      return new Uint8Array(32);
    }
    const h = hashes[hashIndex];
    hashIndex++;
    return h;
  }

  function traverse(depth: number, pos: number): Uint8Array {
    const isMatch = getBit();

    if (depth === height) {
      // Leaf node
      const txHash = getHash();
      if (isMatch && pos < totalTransactions) {
        matchedTxHashes.push(txHash);
      }
      return txHash;
    }

    if (!isMatch) {
      // Not a match path — hash is provided directly
      return getHash();
    }

    // Recurse into children
    const left = traverse(depth + 1, pos * 2);
    const nodesAtDepth = Math.ceil(totalTransactions / (1 << (height - depth)));
    let right: Uint8Array;
    if (pos * 2 + 1 < nodesAtDepth) {
      right = traverse(depth + 1, pos * 2 + 1);
    } else {
      right = left;
    }

    // Hash the pair
    const combined = new Uint8Array(64);
    combined.set(left, 0);
    combined.set(right, 32);
    return sha256(sha256(combined));
  }

  const computedRoot = traverse(0, 0);

  // Verify computed root matches the block header's merkle root
  if (!bytesEqual(computedRoot, merkleBlock.merkleRoot)) {
    throw new Error("Merkle proof validation failed: root mismatch");
  }

  return matchedTxHashes;
}

// ---------------------------------------------------------------------------
// SPVClient
// ---------------------------------------------------------------------------

export class SPVClient {
  private readonly headerStore: HeaderStore;
  private readonly peerManager: PeerManager;

  private events: SPVClientEvents = {};
  private bloomFilter: BloomFilter | undefined;
  private syncing = false;
  private running = false;
  private chainHeight = 0;
  private syncTargetHeight = 0;

  // Track pending merkleblock → tx associations
  private pendingMerkleBlock: MerkleBlockMsg | undefined;
  private pendingTxHashes: Set<string> = new Set();

  constructor(config: SPVClientConfig) {
    this.headerStore = config.headerStore;

    const peerManagerConfig: PeerManagerConfig = {
      network: config.network,
      socketProvider: config.socketProvider,
      nativeDnsResolver: config.nativeDnsResolver,
      targetPeers: 8,
    };

    this.peerManager = new PeerManager(peerManagerConfig);
    this.peerManager.onMessage(this.handlePeerMessage.bind(this));
    this.peerManager.onPeerReady(this.handlePeerReady.bind(this));
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Start the SPV client: connect to peers and begin syncing.
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;

    // Load current chain height from store
    this.chainHeight = await this.headerStore.getChainHeight();

    await this.peerManager.start();
  }

  /**
   * Stop the SPV client and disconnect from all peers.
   */
  stop(): void {
    this.running = false;
    this.syncing = false;
    this.peerManager.stop();
  }

  /**
   * Called when a peer completes the version/verack handshake.
   * Sends our Bloom filter and begins header sync if not already syncing.
   */
  private handlePeerReady(peer: Peer): void {
    // Send Bloom filter to the newly connected peer
    if (this.bloomFilter) {
      const filterPayload = serializeFilterLoad(
        this.bloomFilter.toBytes(),
        this.bloomFilter.numHashFuncs,
        this.bloomFilter.tweak,
        1, // BLOOM_UPDATE_ALL
      );
      peer.sendMessage("filterload", filterPayload);
    }

    // Begin header sync on first ready peer
    if (this.running && !this.syncing) {
      void this.syncHeaders();
    }
  }

  /**
   * Register event handlers.
   */
  setEvents(events: SPVClientEvents): void {
    this.events = events;
  }

  /**
   * Begin syncing the header chain from peers.
   */
  async syncHeaders(): Promise<void> {
    if (this.syncing) {
      return;
    }
    this.syncing = true;

    try {
      this.syncTargetHeight = this.peerManager.getBestHeight();

      while (this.syncing && this.running) {
        const locator = await buildLocator(this.headerStore);
        const stopHash = new Uint8Array(32); // all zeros = give me everything

        const payload = serializeGetHeaders(locator, stopHash);

        const sent = this.peerManager.sendToOne("getheaders", payload);
        if (!sent) {
          // No ready peers, wait and retry
          await delay(5000);
          continue;
        }

        // Wait for headers response (handled via message handler)
        // The message handler will call processHeadersResponse which
        // updates chainHeight. We poll until no more progress or caught up.
        const heightBefore = this.chainHeight;
        await delay(10000); // Allow time for response processing

        // Update target from peers (they may have advanced)
        this.syncTargetHeight = Math.max(
          this.syncTargetHeight,
          this.peerManager.getBestHeight(),
        );

        if (this.chainHeight >= this.syncTargetHeight) {
          // Caught up
          break;
        }

        if (this.chainHeight === heightBefore) {
          // No progress — peers may not have more headers
          // Try again after a longer delay
          await delay(15000);
          if (this.chainHeight === heightBefore) {
            break;
          }
        }
      }
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Create and send a Bloom filter for the given addresses to all peers.
   * Addresses should be pubkey hashes (20 bytes) or script hashes.
   */
  setBloomFilter(addresses: Uint8Array[]): void {
    this.bloomFilter = BloomFilter.forAddresses(addresses, BLOOM_FALSE_POSITIVE_RATE);

    const filterPayload = serializeFilterLoad(
      this.bloomFilter.toBytes(),
      this.bloomFilter.getNumHashFuncs(),
      this.bloomFilter.getTweak(),
      this.bloomFilter.getFlags(),
    );

    this.peerManager.broadcast("filterload", filterPayload);
  }

  /**
   * Broadcast a signed transaction to all connected peers.
   * Returns the transaction hash (double-SHA256, hex, reversed for display).
   */
  broadcastTransaction(rawTx: Uint8Array): string {
    const txHash = sha256(sha256(rawTx));

    for (const peer of this.peerManager.getReadyPeers()) {
      peer.sendMessage("tx", rawTx);
    }

    // Return txid as hex (reversed byte order for display)
    return bytesToHexReversed(txHash);
  }

  /**
   * Get the current chain height.
   */
  getChainHeight(): number {
    return this.chainHeight;
  }

  /**
   * Get sync progress as a value between 0 and 1.
   */
  getSyncProgress(): number {
    if (this.syncTargetHeight <= 0) {
      return 0;
    }
    return Math.min(this.chainHeight / this.syncTargetHeight, 1);
  }

  /**
   * Get the underlying peer manager for advanced use.
   */
  getPeerManager(): PeerManager {
    return this.peerManager;
  }

  // -----------------------------------------------------------------------
  // Message handling
  // -----------------------------------------------------------------------

  private handlePeerMessage(peer: Peer, command: string, payload: Uint8Array): void {
    switch (command) {
      case "headers":
        void this.processHeadersResponse(payload);
        break;
      case "inv":
        this.processInv(peer, payload);
        break;
      case "merkleblock":
        this.processMerkleBlock(payload);
        break;
      case "tx":
        this.processTransaction(payload);
        break;
      case "addr":
        this.processAddr(payload);
        break;
      default:
        break;
    }
  }

  private async processHeadersResponse(payload: Uint8Array): Promise<void> {
    let headers: BlockHeaderMsg[];
    try {
      headers = parseHeaders(payload);
    } catch {
      // Malformed headers payload from peer — skip this batch and
      // allow the sync loop to request again from a different peer.
      return;
    }

    if (headers.length === 0) {
      return;
    }

    // Validate and store headers
    const toStore: StoredBlockHeader[] = [];
    let currentHeight = this.chainHeight;

    for (const header of headers) {
      const hash = hashBlockHeader(header);

      currentHeight++;

      toStore.push({
        hash,
        height: currentHeight,
        version: header.version,
        prevBlock: header.prevBlock,
        merkleRoot: header.merkleRoot,
        timestamp: header.timestamp,
        bits: header.bits,
        nonce: header.nonce,
      });
    }

    try {
      await this.headerStore.saveHeaders(toStore);
      this.chainHeight = currentHeight;

      // Notify listeners
      const lastHeader = toStore[toStore.length - 1];
      if (lastHeader && this.events.onBlockHeader) {
        this.events.onBlockHeader(lastHeader);
      }

      if (this.events.onSyncProgress) {
        this.events.onSyncProgress(this.getSyncProgress());
      }
    } catch {
      // Header storage failure — will retry on next sync round.
      // The in-memory chainHeight is not updated, so the next iteration
      // will re-request the same range.
    }
  }

  private processInv(peer: Peer, payload: Uint8Array): void {
    let items: InvItem[];
    try {
      items = parseInv(payload);
    } catch {
      // Malformed inv payload from peer — ignore this message.
      return;
    }

    // Request data for interesting items
    const wanted: InvItem[] = [];

    for (const item of items) {
      if (item.type === INV_TX || item.type === INV_FILTERED_BLOCK) {
        wanted.push(item);
      }
    }

    if (wanted.length > 0) {
      const getDataPayload = serializeGetData(wanted);
      peer.sendMessage("getdata", getDataPayload);
    }
  }

  private processMerkleBlock(payload: Uint8Array): void {
    let merkleBlock: MerkleBlockMsg;
    try {
      merkleBlock = parseMerkleBlock(payload);
    } catch {
      // Malformed merkleblock from peer — skip this block.
      return;
    }

    // Validate Merkle proof and extract matched transaction hashes
    let matchedHashes: Uint8Array[];
    try {
      matchedHashes = validateMerkleProof(merkleBlock);
    } catch {
      // Invalid Merkle proof — the block's partial tree didn't verify.
      // This could indicate a misbehaving peer or corrupted data.
      return;
    }

    // Store the merkle block for tx association
    this.pendingMerkleBlock = merkleBlock;
    this.pendingTxHashes.clear();
    for (const hash of matchedHashes) {
      this.pendingTxHashes.add(bytesToHex(hash));
    }
  }

  private processTransaction(payload: Uint8Array): void {
    let tx: ParsedTransaction;
    try {
      tx = parseTx(payload);
    } catch {
      // Malformed transaction payload from peer — ignore.
      return;
    }

    // Compute txid. The internal (non-reversed) hash is used to match against
    // the pending merkle block's matched hashes; the reversed form is the
    // canonical display txid handed to listeners (same convention as
    // `hashTransaction` in @fairco.in/core and the block explorer).
    const txHash = sha256(sha256(tx.raw));
    const txHashHex = bytesToHex(txHash);
    const displayTxid = bytesToHexReversed(txHash);

    let blockHash: Uint8Array | undefined;
    if (this.pendingTxHashes.has(txHashHex) && this.pendingMerkleBlock) {
      blockHash = hashBlockHeader({
        version: this.pendingMerkleBlock.version,
        prevBlock: this.pendingMerkleBlock.prevBlock,
        merkleRoot: this.pendingMerkleBlock.merkleRoot,
        timestamp: this.pendingMerkleBlock.timestamp,
        bits: this.pendingMerkleBlock.bits,
        nonce: this.pendingMerkleBlock.nonce,
        txCount: 0,
      });
      this.pendingTxHashes.delete(txHashHex);

      if (this.pendingTxHashes.size === 0) {
        this.pendingMerkleBlock = undefined;
      }
    }

    if (this.events.onTransaction) {
      this.events.onTransaction(tx, displayTxid, blockHash);
    }
  }

  private processAddr(payload: Uint8Array): void {
    try {
      const addresses = parseAddr(payload);
      for (const addr of addresses) {
        const ipStr = extractIPv4FromMapped(addr.ip);
        if (ipStr) {
          this.peerManager.addKnownAddress(ipStr);
        }
      }
    } catch {
      // Malformed addr message from peer — ignore.
    }
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function bytesToHexReversed(bytes: Uint8Array): string {
  let hex = "";
  for (let i = bytes.length - 1; i >= 0; i--) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function extractIPv4FromMapped(ip: Uint8Array): string | undefined {
  // Check for IPv4-mapped IPv6: first 10 bytes 0x00, bytes 10-11 0xff
  if (ip.length !== 16) return undefined;

  let isV4Mapped = true;
  for (let i = 0; i < 10; i++) {
    if (ip[i] !== 0) {
      isV4Mapped = false;
      break;
    }
  }
  if (isV4Mapped && ip[10] === 0xff && ip[11] === 0xff) {
    return `${ip[12]}.${ip[13]}.${ip[14]}.${ip[15]}`;
  }

  return undefined;
}

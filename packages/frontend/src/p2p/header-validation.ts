/**
 * Block-header chain validation for the FairCoin SPV client.
 *
 * SPV_AUDIT.md §4.3: previously `processHeadersResponse` stored every header a
 * peer sent verbatim — no prev-hash linkage, no `nBits` sanity, no checkpoint
 * enforcement. A single malicious peer could therefore graft an arbitrary fake
 * chain onto the wallet and, combined with a Bloom query, display fabricated
 * "confirmed" payments.
 *
 * What this module enforces, and why it matches FairCoin's own rules:
 *
 *  1. **Prev-hash linkage.** Each header must reference the hash of the header
 *     before it (within the batch) and the batch's first header must connect to
 *     a known anchor (the current tip). This is exactly the "non-continuous
 *     headers sequence" check FairCoin's `ProcessMessage("headers")` performs.
 *
 *  2. **`nBits` compact-target sanity.** The encoded difficulty target must be
 *     positive, non-zero, non-overflowing, and `<= ProofOfWorkLimit`. This is
 *     the only part of FairCoin's `CheckProofOfWork` that is actually live —
 *     in FairCoin's `pow.cpp` the `hash > bnTarget` comparison is commented
 *     out, so the network does **not** reject a header for failing
 *     `quarkHash < target`. We deliberately do not impose that comparison
 *     either (see the note in the SPV client): it would diverge from consensus
 *     and, given the unverified custom Quark sub-hashes (SPV_AUDIT.md §4.1
 *     residual risk), could reject valid headers.
 *
 *  3. **Checkpoint lock-in.** If a header's height matches a hard-coded
 *     checkpoint, its hash must match — mirroring `Checkpoints::CheckBlock`.
 *
 * Full DarkGravityWave difficulty-retarget verification is intentionally out of
 * scope: it requires a contiguous, correctly-hashed block index from genesis,
 * which an SPV header stream (which can start from a checkpoint and is hashed
 * with the not-yet-vector-verified Quark implementation) cannot reliably
 * reproduce. The linkage + checkpoint + target-sanity checks are the subset
 * that is sound to enforce header-only.
 */

import type { BlockHeader } from "@fairco.in/core";
import { hashBlockHeader } from "@fairco.in/core";
import type { BlockHeaderMsg } from "./messages";

// ---------------------------------------------------------------------------
// Compact ("nBits") target encoding — Bitcoin/FairCoin `uint256::SetCompact`.
// ---------------------------------------------------------------------------

export interface CompactTarget {
  /** The decoded 256-bit target value. */
  readonly target: bigint;
  /** True if the compact encoding had its sign bit set (an invalid target). */
  readonly negative: boolean;
  /** True if the mantissa/exponent combination overflows 256 bits. */
  readonly overflow: boolean;
}

const U256_MASK = (1n << 256n) - 1n;

/**
 * Decode a compact difficulty target ("nBits") into a 256-bit value, faithfully
 * reproducing FairCoin's `uint256::SetCompact` including its sign/overflow flags.
 */
export function compactToTarget(bits: number): CompactTarget {
  const nSize = (bits >>> 24) & 0xff;
  const nWord = bits & 0x007fffff;

  let target: bigint;
  if (nSize <= 3) {
    target = BigInt(nWord >>> (8 * (3 - nSize)));
  } else {
    target = (BigInt(nWord) << BigInt(8 * (nSize - 3))) & U256_MASK;
  }

  const negative = nWord !== 0 && (bits & 0x00800000) !== 0;
  const overflow =
    nWord !== 0 &&
    (nSize > 34 ||
      (nWord > 0xff && nSize > 33) ||
      (nWord > 0xffff && nSize > 32));

  return { target, negative, overflow };
}

/**
 * The proof-of-work limit (easiest allowed target) for a network, as a 256-bit
 * value. Both FairCoin mainnet and testnet use `~uint256(0) >> 20`
 * (`CTestNetParams` inherits it from `CMainParams`). Only regtest differs, and
 * this wallet never targets regtest.
 */
export function proofOfWorkLimit(): bigint {
  return U256_MASK >> 20n;
}

/**
 * Whether a header's `nBits` encodes a valid, in-range difficulty target.
 *
 * Mirrors the live portion of FairCoin's `CheckProofOfWork`: reject negative,
 * zero, overflowing, or above-limit targets. (The `hash > target` comparison is
 * commented out in FairCoin and is not enforced here either.)
 */
export function isValidTargetBits(bits: number, powLimit: bigint): boolean {
  const { target, negative, overflow } = compactToTarget(bits);
  if (negative || overflow) return false;
  if (target === 0n) return false;
  if (target > powLimit) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Header chain validation
// ---------------------------------------------------------------------------

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function toCoreHeader(header: BlockHeaderMsg): BlockHeader {
  return {
    version: header.version,
    prevHash: header.prevBlock,
    merkleRoot: header.merkleRoot,
    timestamp: header.timestamp,
    bits: header.bits,
    nonce: header.nonce,
  };
}

export interface ValidatedHeader {
  /** Quark hash of the header (internal byte order). */
  readonly hash: Uint8Array;
  /** Absolute chain height of this header. */
  readonly height: number;
  readonly header: BlockHeaderMsg;
}

export interface HeaderChainAnchor {
  /** Hash of the header the batch must connect to (the current tip). */
  readonly hash: Uint8Array;
  /** Height of that anchor header. */
  readonly height: number;
}

export interface ValidateHeaderChainParams {
  /** Headers as received from the peer, in order. */
  readonly headers: BlockHeaderMsg[];
  /**
   * The header the first item must build on. `undefined` only when the store is
   * empty and the first header is expected to be genesis (height 0).
   */
  readonly anchor: HeaderChainAnchor | undefined;
  /** Easiest allowed target for this network. */
  readonly powLimit: bigint;
  /** Lookup of a hard-coded checkpoint hash (hex) for a height, if any. */
  readonly checkpointHashHex?: (height: number) => string | null;
  /** Expected genesis hash (hex), used when there is no anchor. */
  readonly genesisHashHex?: string;
}

export class HeaderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeaderValidationError";
  }
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Validate a batch of headers and assign each an absolute height.
 *
 * Throws {@link HeaderValidationError} on the first invalid header. On success
 * returns every header with its computed hash and height, ready to be stored.
 *
 * @param hashFn Header-hashing function. Defaults to FairCoin's Quark header
 *   hash; injectable so tests can exercise the linkage/target/checkpoint logic
 *   deterministically without depending on the (heavy) Quark implementation.
 */
export function validateHeaderChain(
  params: ValidateHeaderChainParams,
  hashFn: (header: BlockHeaderMsg) => Uint8Array = (h) =>
    hashBlockHeader(toCoreHeader(h)),
): ValidatedHeader[] {
  const { headers, anchor, powLimit, checkpointHashHex, genesisHashHex } =
    params;

  const result: ValidatedHeader[] = [];
  let prevHash = anchor?.hash;
  let height = anchor ? anchor.height : -1;

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];

    // 1. nBits compact-target sanity (the live part of CheckProofOfWork).
    if (!isValidTargetBits(header.bits, powLimit)) {
      throw new HeaderValidationError(
        `header ${i}: invalid difficulty bits 0x${header.bits.toString(16)}`,
      );
    }

    // 2. Prev-hash linkage.
    if (prevHash === undefined) {
      // No anchor: the first header must be genesis and must self-identify by
      // matching the known genesis hash. (Genesis has no predecessor.)
      const hash = hashFn(header);
      if (genesisHashHex && toHex(hash) !== genesisHashHex) {
        throw new HeaderValidationError(
          "first header does not match genesis and no anchor was provided",
        );
      }
      height = 0;
      assertCheckpoint(height, hash, checkpointHashHex);
      result.push({ hash, height, header });
      prevHash = hash;
      continue;
    }

    if (!bytesEqual(header.prevBlock, prevHash)) {
      throw new HeaderValidationError(
        `header ${i}: prevBlock does not link to the previous header (non-continuous chain)`,
      );
    }

    const hash = hashFn(header);
    height += 1;

    // 3. Checkpoint lock-in.
    assertCheckpoint(height, hash, checkpointHashHex);

    result.push({ hash, height, header });
    prevHash = hash;
  }

  return result;
}

function assertCheckpoint(
  height: number,
  hash: Uint8Array,
  checkpointHashHex?: (height: number) => string | null,
): void {
  if (!checkpointHashHex) return;
  const expected = checkpointHashHex(height);
  if (expected && toHex(hash) !== expected) {
    throw new HeaderValidationError(
      `header at height ${height} does not match checkpoint`,
    );
  }
}

// ---------------------------------------------------------------------------
// Chain-update decision (extension vs reorg vs reject)
// ---------------------------------------------------------------------------

export type ChainUpdateAction = "extend" | "reorg" | "ignore";

export interface ChainUpdatePlan {
  readonly action: ChainUpdateAction;
  /** For a reorg: the height to roll the wallet back to (the fork point). */
  readonly forkHeight: number;
  /** The new tip height after applying this batch. */
  readonly newTipHeight: number;
}

export interface PlanChainUpdateParams {
  /** Height the validated batch builds on (the anchor), -1 when from genesis. */
  readonly anchorHeight: number;
  /** Height of the last header in the validated batch. */
  readonly batchTipHeight: number;
  /** Current stored tip height, -1 when the store is empty. */
  readonly currentTipHeight: number;
  /** Maximum allowed reorg depth (FairCoin: network.maxReorgDepth). */
  readonly maxReorgDepth: number;
}

/**
 * Decide what to do with a validated header batch, separated from all I/O so it
 * is directly unit-testable (SPV_AUDIT.md §4.3/§4.4).
 *
 *  - `extend`: the batch builds directly on the current tip (or is the first
 *    chain in an empty store).
 *  - `reorg`: the batch forks below the current tip and is strictly longer, and
 *    the fork is within `maxReorgDepth`. The caller must rewind to `forkHeight`
 *    before storing the batch.
 *  - `ignore`: the batch forks below the tip but is not longer, or the fork is
 *    deeper than `maxReorgDepth` (a stale or abusive branch). The active chain
 *    is kept.
 */
export function planChainUpdate(params: PlanChainUpdateParams): ChainUpdatePlan {
  const { anchorHeight, batchTipHeight, currentTipHeight, maxReorgDepth } =
    params;

  // Empty store, or the batch builds right on the tip → simple extension.
  if (currentTipHeight < 0 || anchorHeight >= currentTipHeight) {
    return {
      action: "extend",
      forkHeight: anchorHeight,
      newTipHeight: batchTipHeight,
    };
  }

  // Forks below the tip: only accept a strictly longer competing chain.
  if (batchTipHeight <= currentTipHeight) {
    return { action: "ignore", forkHeight: anchorHeight, newTipHeight: currentTipHeight };
  }

  // Reject forks deeper than the maximum reorg depth.
  if (currentTipHeight - anchorHeight > maxReorgDepth) {
    return { action: "ignore", forkHeight: anchorHeight, newTipHeight: currentTipHeight };
  }

  return {
    action: "reorg",
    forkHeight: anchorHeight,
    newTipHeight: batchTipHeight,
  };
}

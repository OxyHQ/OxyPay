/**
 * Pure, dependency-free FairCoin money math and coin selection.
 *
 * Everything here is exact BigInt arithmetic with NO imports from the
 * `@fairco.in/*` ESM packages, so it can be unit-tested under `bun test`
 * without loading those libraries. The on-chain service composes these helpers
 * with the lib's signing/serialisation primitives.
 *
 * FAIR has 8 decimals: 1 FAIR = 100_000_000 base units (m⊜).
 */

/** Smallest units per whole FAIR coin. Mirrors `@fairco.in/core` UNITS_PER_COIN. */
export const FAIR_UNITS_PER_COIN = 100_000_000n;
/** Bytes per kilobyte — `estimatesmartfee` quotes FAIR per kB. */
export const BYTES_PER_KB = 1000n;

/**
 * Convert a FAIR decimal string (e.g. "1.23456789") to base units (BigInt).
 *
 * Done with pure integer arithmetic on the digit string — no float, no
 * bignumber dependency — so it is loss-free for the unit-test surface. Throws
 * on malformed input or more than 8 fractional digits. Accepts an optional
 * leading sign.
 */
export function fairToBaseUnits(fair: string): bigint {
  const trimmed = fair.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`fairToBaseUnits: invalid FAIR decimal "${fair}"`);
  }
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, fraction = ''] = unsigned.split('.');
  if (fraction.length > 8) {
    throw new Error(`fairToBaseUnits: too many fractional digits in "${fair}" (max 8)`);
  }
  const paddedFraction = fraction.padEnd(8, '0');
  const base = BigInt(whole) * FAIR_UNITS_PER_COIN + BigInt(paddedFraction);
  return negative ? -base : base;
}

/**
 * Convert base units (BigInt) to a FAIR decimal string with exactly 8
 * fractional digits. Inverse of {@link fairToBaseUnits} for non-negative input.
 */
export function baseUnitsToFair(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / FAIR_UNITS_PER_COIN;
  const fraction = abs % FAIR_UNITS_PER_COIN;
  const fractionStr = fraction.toString().padStart(8, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fractionStr}`;
}

/**
 * Convert an `estimatesmartfee` feerate (FAIR per kB) into base-units-per-byte.
 *
 * The feerate is a float from the node; it is stringified by the caller and
 * parsed loss-free into base-units-per-kB, then divided by 1000 bytes with
 * ROUND-UP (ceil) semantics so we never under-pay the relay fee. Returns a
 * value >= 1 whenever the feerate is positive.
 *
 * Returns null when the feerate is non-positive (caller falls back to a
 * configured default).
 */
export function convertFeerateToFeePerByte(feerateFairPerKb: string): bigint | null {
  const baseUnitsPerKb = fairToBaseUnits(feerateFairPerKb);
  if (baseUnitsPerKb <= 0n) return null;
  // Ceil division: (a + b - 1) / b for positive integers.
  const feePerByte = (baseUnitsPerKb + BYTES_PER_KB - 1n) / BYTES_PER_KB;
  return feePerByte > 0n ? feePerByte : 1n;
}

/** A coin available for spending. The selector only needs value + identity. */
export interface SelectableUtxo {
  txid: string;
  vout: number;
  value: bigint;
}

/** Result of coin selection. */
export interface CoinSelectionResult<T extends SelectableUtxo> {
  selected: T[];
  /** Total value of the selected inputs (base units). */
  totalIn: bigint;
  /** The fee implied by the final selected input count. */
  fee: bigint;
}

/**
 * Deterministic coin selection.
 *
 * Inputs are sorted ascending by value, then by `txid:vout`, so the same UTXO
 * set + target always selects the same coins (auditable, reproducible). Coins
 * are accumulated until `totalIn >= amount + fee(currentInputCount, numOutputs)`,
 * where the fee is recomputed as inputs are added because each input grows the
 * estimated transaction size.
 *
 * `estimateSize` mirrors the lib's `estimateTxSize` and is injected so this
 * function stays free of `@fairco.in/*` imports (testable in isolation).
 *
 * Throws `Error('insufficient_funds')` if the coins cannot cover amount + fee.
 * Always sends to one recipient + one change output, so `numOutputs` is 2.
 */
export function selectUtxos<T extends SelectableUtxo>(
  utxos: readonly T[],
  amount: bigint,
  feePerByte: bigint,
  numOutputs: number,
  estimateSize: (numInputs: number, numOutputs: number) => number
): CoinSelectionResult<T> {
  if (amount <= 0n) {
    throw new Error('selectUtxos: amount must be positive');
  }
  const sorted = [...utxos].sort((a, b) => {
    if (a.value < b.value) return -1;
    if (a.value > b.value) return 1;
    const aKey = `${a.txid}:${a.vout}`;
    const bKey = `${b.txid}:${b.vout}`;
    if (aKey < bKey) return -1;
    if (aKey > bKey) return 1;
    return 0;
  });

  const selected: T[] = [];
  let totalIn = 0n;
  for (const utxo of sorted) {
    selected.push(utxo);
    totalIn += utxo.value;
    const fee = feePerByte * BigInt(estimateSize(selected.length, numOutputs));
    if (totalIn >= amount + fee) {
      return { selected, totalIn, fee };
    }
  }
  throw new Error('insufficient_funds');
}

/** Canonical external reference for a received output: `<txid>:<vout>`. */
export function buildExternalRef(txid: string, vout: number): string {
  return `${txid}:${vout}`;
}

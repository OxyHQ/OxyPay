import { describe, expect, it } from 'bun:test';
import {
  fairToBaseUnits,
  baseUnitsToFair,
  convertFeerateToFeePerByte,
  selectUtxos,
  buildExternalRef,
  FAIR_UNITS_PER_COIN,
  type SelectableUtxo,
} from '../faircoinMath';

/**
 * Local mirror of `@fairco.in/core`'s `estimateTxSize`
 * (TX_OVERHEAD=10 + 148 per input + 34 per output) so the coin-selection test
 * stays free of the ESM lib imports.
 */
const TX_OVERHEAD = 10;
const BYTES_PER_INPUT = 148;
const BYTES_PER_OUTPUT = 34;
const estimateSize = (numInputs: number, numOutputs: number): number =>
  TX_OVERHEAD + numInputs * BYTES_PER_INPUT + numOutputs * BYTES_PER_OUTPUT;

describe('fairToBaseUnits / baseUnitsToFair', () => {
  it('converts whole coins exactly', () => {
    expect(fairToBaseUnits('1')).toBe(FAIR_UNITS_PER_COIN);
    expect(fairToBaseUnits('1')).toBe(100_000_000n);
    expect(fairToBaseUnits('0')).toBe(0n);
  });

  it('converts fractional coins without float loss', () => {
    expect(fairToBaseUnits('1.23456789')).toBe(123_456_789n);
    expect(fairToBaseUnits('0.00000001')).toBe(1n);
    expect(fairToBaseUnits('0.1')).toBe(10_000_000n);
    // A value that is famously lossy in IEEE-754 floats:
    expect(fairToBaseUnits('0.1') + fairToBaseUnits('0.2')).toBe(fairToBaseUnits('0.3'));
  });

  it('round-trips through baseUnitsToFair', () => {
    expect(baseUnitsToFair(123_456_789n)).toBe('1.23456789');
    expect(baseUnitsToFair(1n)).toBe('0.00000001');
    expect(baseUnitsToFair(100_000_000n)).toBe('1.00000000');
    expect(fairToBaseUnits(baseUnitsToFair(987_654_321n))).toBe(987_654_321n);
  });

  it('rejects malformed input and excess precision', () => {
    expect(() => fairToBaseUnits('abc')).toThrow();
    expect(() => fairToBaseUnits('')).toThrow();
    expect(() => fairToBaseUnits('1.123456789')).toThrow(); // 9 fractional digits
  });
});

describe('convertFeerateToFeePerByte', () => {
  it('converts FAIR/kB to ceil base-units-per-byte', () => {
    // 0.00001 FAIR/kB = 1000 base units / 1000 bytes = 1 base unit/byte.
    expect(convertFeerateToFeePerByte('0.00001')).toBe(1n);
    // 0.0001 FAIR/kB = 10000 base units / 1000 bytes = 10 base units/byte.
    expect(convertFeerateToFeePerByte('0.0001')).toBe(10n);
  });

  it('rounds up (never under-pays)', () => {
    // 1500 base units / 1000 bytes = 1.5 -> ceil 2.
    expect(convertFeerateToFeePerByte('0.000015')).toBe(2n);
    // 1 base unit / 1000 bytes = 0.001 -> ceil 1 (floor at 1).
    expect(convertFeerateToFeePerByte('0.00000001')).toBe(1n);
  });

  it('returns null for non-positive feerate', () => {
    expect(convertFeerateToFeePerByte('0')).toBeNull();
    expect(convertFeerateToFeePerByte('-1')).toBeNull();
  });
});

describe('selectUtxos', () => {
  const utxos: SelectableUtxo[] = [
    { txid: 'aa', vout: 0, value: 50_000_000n }, // 0.5 FAIR
    { txid: 'bb', vout: 1, value: 200_000_000n }, // 2 FAIR
    { txid: 'cc', vout: 0, value: 100_000_000n }, // 1 FAIR
  ];

  it('selects the smallest coins first, deterministically', () => {
    const feePerByte = 10n;
    const target = 40_000_000n; // 0.4 FAIR
    const result = selectUtxos(utxos, target, feePerByte, 2, estimateSize);
    // 0.5 FAIR alone (50_000_000) covers 0.4 + fee(1 input, 2 outputs).
    const fee = feePerByte * BigInt(estimateSize(1, 2));
    expect(result.selected.map((u) => `${u.txid}:${u.vout}`)).toEqual(['aa:0']);
    expect(result.totalIn).toBe(50_000_000n);
    expect(result.fee).toBe(fee);
    expect(result.totalIn >= target + result.fee).toBe(true);
  });

  it('accumulates multiple inputs when one is not enough', () => {
    const feePerByte = 10n;
    const target = 120_000_000n; // 1.2 FAIR
    const result = selectUtxos(utxos, target, feePerByte, 2, estimateSize);
    // smallest-first: 0.5 + 1.0 = 1.5 FAIR covers 1.2 + fee(2 inputs).
    expect(result.selected.map((u) => `${u.txid}:${u.vout}`)).toEqual(['aa:0', 'cc:0']);
    expect(result.totalIn).toBe(150_000_000n);
    expect(result.totalIn >= target + result.fee).toBe(true);
  });

  it('is deterministic across input ordering (tie-break by txid:vout)', () => {
    const shuffled: SelectableUtxo[] = [utxos[2], utxos[0], utxos[1]];
    const a = selectUtxos(utxos, 120_000_000n, 10n, 2, estimateSize);
    const b = selectUtxos(shuffled, 120_000_000n, 10n, 2, estimateSize);
    expect(a.selected.map((u) => `${u.txid}:${u.vout}`)).toEqual(
      b.selected.map((u) => `${u.txid}:${u.vout}`)
    );
  });

  it('throws insufficient_funds when coins cannot cover amount + fee', () => {
    const target = 400_000_000n; // 4 FAIR; pool only holds 3.5 FAIR
    expect(() => selectUtxos(utxos, target, 10n, 2, estimateSize)).toThrow('insufficient_funds');
  });

  it('accounts for fee at the boundary (just-insufficient because of fee)', () => {
    const pool: SelectableUtxo[] = [{ txid: 'dd', vout: 0, value: 100_000_000n }];
    const feePerByte = 10n;
    const fee = feePerByte * BigInt(estimateSize(1, 2));
    // target exactly equals value, leaving nothing for the fee -> insufficient.
    expect(() => selectUtxos(pool, 100_000_000n, feePerByte, 2, estimateSize)).toThrow(
      'insufficient_funds'
    );
    // target = value - fee succeeds.
    const ok = selectUtxos(pool, 100_000_000n - fee, feePerByte, 2, estimateSize);
    expect(ok.selected.length).toBe(1);
  });

  it('rejects non-positive target', () => {
    expect(() => selectUtxos(utxos, 0n, 10n, 2, estimateSize)).toThrow();
  });
});

describe('buildExternalRef', () => {
  it('builds the canonical txid:vout key', () => {
    expect(buildExternalRef('deadbeef', 0)).toBe('deadbeef:0');
    expect(buildExternalRef('cafe', 3)).toBe('cafe:3');
  });
});

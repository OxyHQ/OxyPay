/**
 * In-memory UTXO reservation for in-flight sends (review finding M4).
 *
 * Coin selection runs against the database's confirmed-unspent rows. A second
 * send started before the first has marked its inputs spent would see those same
 * rows as available and could select the SAME coins, producing a double-spend
 * the network rejects. `sendTransaction` reserves its selected outpoints here
 * for the duration of the send: candidates already reserved are filtered out of
 * automatic selection, and a coin-control selection that overlaps a reservation
 * is refused outright. Reservations are released on success and on failure.
 *
 * This is deliberately a tiny, synchronous, I/O-free primitive so the
 * funds-safety invariant ("no two overlapping sends share an outpoint") is
 * unit-testable in isolation — the same approach as {@link ./coin-selection}.
 *
 * Single-process only: it guards concurrent async send *flows* within one app
 * instance (the real risk here), not multiple OS processes.
 */

export interface Outpoint {
  readonly txid: string;
  readonly vout: number;
}

function outpointKey(txid: string, vout: number): string {
  return `${txid}:${vout}`;
}

export class UtxoReservation {
  private readonly reserved: Set<string> = new Set();

  /** Whether the given outpoint is currently reserved by an in-flight send. */
  has(txid: string, vout: number): boolean {
    return this.reserved.has(outpointKey(txid, vout));
  }

  /**
   * Reserve every outpoint in `outpoints` atomically. If ANY of them is already
   * reserved, nothing is reserved and the conflicting key is returned so the
   * caller can refuse the send. On success returns `null`.
   *
   * Callers MUST invoke this synchronously (before awaiting) relative to their
   * selection so two flows cannot both pass the conflict check before either
   * reserves — JavaScript's single-threaded model then guarantees exclusivity.
   */
  reserve(outpoints: readonly Outpoint[]): string | null {
    for (const { txid, vout } of outpoints) {
      if (this.reserved.has(outpointKey(txid, vout))) {
        return outpointKey(txid, vout);
      }
    }
    for (const { txid, vout } of outpoints) {
      this.reserved.add(outpointKey(txid, vout));
    }
    return null;
  }

  /** Release a set of outpoints (e.g. when a send completes or fails). */
  release(outpoints: readonly Outpoint[]): void {
    for (const { txid, vout } of outpoints) {
      this.reserved.delete(outpointKey(txid, vout));
    }
  }

  /** Drop all reservations (used on wallet reset/lock/switch). */
  clear(): void {
    this.reserved.clear();
  }

  /** Number of currently-reserved outpoints (for diagnostics/tests). */
  get size(): number {
    return this.reserved.size;
  }
}

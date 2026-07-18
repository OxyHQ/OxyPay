/**
 * Bridges the SPV client's HeaderStore interface to our SQLite Database class.
 *
 * Converts between the SPV client's binary representations (Uint8Array hashes)
 * and the Database's hex-string storage format.
 */

import type { HeaderStore, StoredBlockHeader } from "./spv-client";
import type { Database, BlockHeaderRow } from "../storage/database";
import { hexToBytes, bytesToHex } from "@fairco.in/core";

// ---------------------------------------------------------------------------
// DatabaseHeaderStore
// ---------------------------------------------------------------------------

export class DatabaseHeaderStore implements HeaderStore {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async getLatestHeader(): Promise<StoredBlockHeader | undefined> {
    const row = await this.db.getLatestHeader();
    if (!row) return undefined;
    return rowToStoredHeader(row);
  }

  async getHeaderByHash(hash: Uint8Array): Promise<StoredBlockHeader | undefined> {
    const hashHex = bytesToHex(hash);
    const row = await this.db.getHeaderByHash(hashHex);
    if (!row) return undefined;
    return rowToStoredHeader(row);
  }

  async getHeaderByHeight(height: number): Promise<StoredBlockHeader | undefined> {
    const row = await this.db.getHeaderByHeight(height);
    if (!row) return undefined;
    return rowToStoredHeader(row);
  }

  /**
   * Save headers using batch insert for performance.
   * During SPV sync, headers arrive in batches of 2,000.
   * Using a prepared statement inside a transaction is ~100x faster
   * than individual INSERT calls.
   */
  async saveHeaders(headers: StoredBlockHeader[]): Promise<void> {
    const rows: BlockHeaderRow[] = headers.map((h) => ({
      height: h.height,
      hash: bytesToHex(h.hash),
      prev_hash: bytesToHex(h.prevBlock),
      merkle_root: bytesToHex(h.merkleRoot),
      timestamp: h.timestamp,
      bits: h.bits,
      nonce: h.nonce,
      version: h.version,
    }));
    await this.db.insertHeadersBatch(rows);
  }

  async getChainHeight(): Promise<number> {
    const latest = await this.db.getLatestHeader();
    if (!latest) return 0;
    return latest.height;
  }

  async deleteHeadersAboveHeight(height: number): Promise<void> {
    await this.db.deleteHeadersAboveHeight(height);
  }
}

// ---------------------------------------------------------------------------
// Conversion helper
// ---------------------------------------------------------------------------

function rowToStoredHeader(row: BlockHeaderRow): StoredBlockHeader {
  return {
    height: row.height,
    hash: hexToBytes(row.hash),
    prevBlock: hexToBytes(row.prev_hash),
    merkleRoot: hexToBytes(row.merkle_root),
    timestamp: row.timestamp,
    bits: row.bits,
    nonce: row.nonce,
    version: row.version,
  };
}

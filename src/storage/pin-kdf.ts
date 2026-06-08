/**
 * PIN key-derivation and record format (review finding M2).
 *
 * A 6-digit PIN has only 10^6 possibilities, so the previous unsalted single
 * SHA-256 was trivially brute-forced from a leaked store via a precomputed
 * table. This module derives PIN hashes with scrypt — a memory-hard,
 * deliberately-slow KDF — using a per-record random salt, and defines a
 * versioned on-disk record so legacy (v1, unsalted SHA-256) PINs can be
 * detected and migrated.
 *
 * Pure (no storage / React Native imports) so the security-critical logic is
 * directly unit-testable.
 */

import { sha256 } from "@noble/hashes/sha256";
import { scryptAsync } from "@noble/hashes/scrypt";
import { bytesToHex, hexToBytes } from "@fairco.in/core";

/** scrypt cost parameters. N=2^15 keeps a single PIN check well under ~200ms. */
const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1, dkLen: 32 } as const;
const SCRYPT_SALT_BYTES = 16;
/** Marks a salted-scrypt record: `scrypt$<saltHex>$<hashHex>`. */
export const PIN_SCHEME_PREFIX = "scrypt$";

/**
 * Legacy (v1) unsalted SHA-256 hash with a domain separator. Exported only so
 * `verifyPinRecord` can verify and then migrate PINs stored before scrypt.
 */
export function legacyHashPin(pin: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(`fairwallet:pin:${pin}`);
  return bytesToHex(sha256(data));
}

/** Cryptographically-random salt for a new PIN record. */
function generatePinSalt(): Uint8Array {
  const salt = new Uint8Array(SCRYPT_SALT_BYTES);
  crypto.getRandomValues(salt);
  return salt;
}

/** Derive the scrypt hash of `pin` with `salt`, returned as hex. */
async function scryptHashPin(pin: string, salt: Uint8Array): Promise<string> {
  const encoder = new TextEncoder();
  const derived = await scryptAsync(encoder.encode(pin), salt, SCRYPT_PARAMS);
  return bytesToHex(derived);
}

/** Whether a stored record uses the salted-scrypt scheme. */
export function isScryptRecord(record: string): boolean {
  return record.startsWith(PIN_SCHEME_PREFIX);
}

/**
 * Build a fresh salted-scrypt record string for `pin`:
 * `scrypt$<saltHex>$<hashHex>`. Each call uses a new random salt.
 */
export async function buildPinRecord(pin: string): Promise<string> {
  const salt = generatePinSalt();
  const hashHex = await scryptHashPin(pin, salt);
  return `${PIN_SCHEME_PREFIX}${bytesToHex(salt)}$${hashHex}`;
}

/** Constant-time string comparison to avoid timing leaks on PIN verification. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export interface PinVerifyResult {
  /** Whether the supplied PIN matched the stored record. */
  readonly valid: boolean;
  /**
   * A new scrypt record to persist (legacy record was matched and should be
   * upgraded), or null when no migration is needed.
   */
  readonly upgradedRecord: string | null;
}

/**
 * Verify `pin` against a stored `record`. Supports both the salted-scrypt
 * scheme and the legacy unsalted SHA-256 scheme; when a legacy record matches,
 * returns an `upgradedRecord` so the caller can transparently re-store the PIN
 * under scrypt (so the weak hash never survives the next unlock).
 */
export async function verifyPinRecord(
  pin: string,
  record: string,
): Promise<PinVerifyResult> {
  if (isScryptRecord(record)) {
    const parts = record.slice(PIN_SCHEME_PREFIX.length).split("$");
    if (parts.length !== 2) {
      return { valid: false, upgradedRecord: null };
    }
    const [saltHex, expectedHash] = parts;
    let salt: Uint8Array;
    try {
      salt = hexToBytes(saltHex);
    } catch {
      // Corrupt salt encoding — fail verification rather than throw.
      return { valid: false, upgradedRecord: null };
    }
    const candidate = await scryptHashPin(pin, salt);
    return {
      valid: constantTimeEqual(candidate, expectedHash),
      upgradedRecord: null,
    };
  }

  // Legacy unsalted SHA-256 record.
  const valid = constantTimeEqual(record, legacyHashPin(pin));
  if (!valid) {
    return { valid: false, upgradedRecord: null };
  }
  return { valid: true, upgradedRecord: await buildPinRecord(pin) };
}

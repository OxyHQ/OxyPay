/**
 * Tests for BIP44 key derivation and, in particular, cursor persistence
 * (SPV_AUDIT.md §4.5).
 *
 * `KeyManager.fromMnemonic` always resets the receive/change cursors to 0, so
 * without `restoreCursors` a wallet re-issues the same "next receive address"
 * on every launch and can miss funds beyond the initial gap window. These tests
 * prove the cursor survives a simulated restart and that used addresses are not
 * re-issued.
 */

import { describe, test, expect } from "bun:test";
import { getNetwork } from "@fairco.in/core";
import { KeyManager } from "./key-manager";

const MAINNET = getNetwork("mainnet");

// Canonical BIP39 trial mnemonic — deterministic derivation.
const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

describe("KeyManager cursor persistence", () => {
  test("a fresh manager starts both cursors at 0", () => {
    const km = KeyManager.fromMnemonic(MNEMONIC, MAINNET);
    expect(km.getNextExternalIndex()).toBe(0);
    expect(km.getNextChangeIndex()).toBe(0);
  });

  test("restoreCursors advances the cursors and the next address skips used ones", () => {
    // First run: hand out 3 receive addresses (indices 0,1,2 become used).
    const first = KeyManager.fromMnemonic(MNEMONIC, MAINNET);
    const issued = [
      first.getNextAddress(),
      first.getNextAddress(),
      first.getNextAddress(),
    ];
    expect(issued.map((a) => a.index)).toEqual([0, 1, 2]);
    expect(first.getNextExternalIndex()).toBe(3);

    // Simulated restart: a brand-new manager from the same mnemonic. The DB
    // recorded that index 2 was the highest used, so the next unused is 3.
    const restarted = KeyManager.fromMnemonic(MNEMONIC, MAINNET);
    expect(restarted.getNextExternalIndex()).toBe(0); // reset on construct
    restarted.restoreCursors(3, 0);
    expect(restarted.getNextExternalIndex()).toBe(3);

    // The next receive address is index 3, NOT 0 — used addresses survived.
    const next = restarted.getNextAddress();
    expect(next.index).toBe(3);
    // And it is the SAME deterministic address the first manager would issue.
    const firstFourth = first.getNextAddress();
    expect(next.address).toBe(firstFourth.address);
  });

  test("restoreCursors only ever moves a cursor forward", () => {
    const km = KeyManager.fromMnemonic(MNEMONIC, MAINNET);
    km.getNextAddress(); // cursor -> 1
    km.getNextAddress(); // cursor -> 2
    km.restoreCursors(1, 0); // lower than current: ignored
    expect(km.getNextExternalIndex()).toBe(2);
  });

  test("restoreCursors pre-derives the lookahead window so addresses are watched", () => {
    const km = KeyManager.fromMnemonic(MNEMONIC, MAINNET);
    // Advance the external cursor far ahead, as if many addresses were used.
    km.restoreCursors(50, 0);
    const external = km.getExternalAddresses();
    // At least cursor + gap-limit (20) addresses must be derived and watchable.
    expect(external.length).toBeGreaterThanOrEqual(70);

    // The address at the restored cursor must be present (so the Bloom filter
    // built from getAllAddresses() watches it).
    const next = km.getNextAddress();
    expect(next.index).toBe(50);
    expect(km.ownsAddress(next.address)).toBe(true);
  });

  test("change cursor restores independently of the external cursor", () => {
    const km = KeyManager.fromMnemonic(MNEMONIC, MAINNET);
    km.restoreCursors(0, 5);
    expect(km.getNextChangeIndex()).toBe(5);
    expect(km.getNextExternalIndex()).toBe(0);
    const change = km.getNextChangeAddress();
    expect(change.index).toBe(5);
  });
});

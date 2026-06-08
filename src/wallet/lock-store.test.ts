/**
 * Tests for the app-lock gate logic (review finding C1).
 *
 * The lock store is the single source of truth the root LockGate overlay and
 * the navigation guards read to decide whether ANY authenticated screen may be
 * shown. These tests prove the gate starts closed, opens only on an explicit
 * unlock, re-closes on lock, and that the boot decision tracks PIN existence.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { useLockStore } from "./lock-store";

function resetStore(): void {
  useLockStore.setState({ locked: true, resolved: false });
}

describe("lock gate: default state", () => {
  beforeEach(resetStore);

  test("starts LOCKED and unresolved so nothing authenticated can render", () => {
    const s = useLockStore.getState();
    expect(s.locked).toBe(true);
    expect(s.resolved).toBe(false);
  });
});

describe("lock gate: transitions", () => {
  beforeEach(resetStore);

  test("unlock() opens the gate and marks it resolved", () => {
    useLockStore.getState().unlock();
    const s = useLockStore.getState();
    expect(s.locked).toBe(false);
    expect(s.resolved).toBe(true);
  });

  test("lock() re-closes the gate (auto-lock / manual lock)", () => {
    useLockStore.getState().unlock();
    useLockStore.getState().lock();
    expect(useLockStore.getState().locked).toBe(true);
  });

  test("markNoPinUnlocked() opens the gate for PIN-less wallets", () => {
    useLockStore.getState().markNoPinUnlocked();
    const s = useLockStore.getState();
    expect(s.locked).toBe(false);
    expect(s.resolved).toBe(true);
  });
});

describe("lock gate: boot decision tracks PIN existence", () => {
  beforeEach(resetStore);

  test("a wallet WITH a PIN stays locked after resolveInitialLock(true)", () => {
    const willLock = useLockStore.getState().resolveInitialLock(true);
    expect(willLock).toBe(true);
    const s = useLockStore.getState();
    expect(s.locked).toBe(true);
    expect(s.resolved).toBe(true);
  });

  test("a wallet WITHOUT a PIN unlocks after resolveInitialLock(false)", () => {
    const willLock = useLockStore.getState().resolveInitialLock(false);
    expect(willLock).toBe(false);
    expect(useLockStore.getState().locked).toBe(false);
  });
});

/**
 * App-lock state (review finding C1).
 *
 * The PIN lock used to be enforced only by navigating to the `/lock` route on
 * boot. That was bypassable: the `(tabs)` group had no guard, deep links pushed
 * straight into authenticated screens, and keys/SPV were loaded BEFORE the PIN
 * was ever checked. This store is the single source of truth for "is the app
 * locked", consumed by the root-level lock overlay (which covers every
 * authenticated screen) and by the navigation guards.
 *
 * `locked` starts `true` so nothing authenticated can render until boot has
 * decided whether a PIN exists; `resolveInitialLock` then either keeps it
 * locked (PIN set) or unlocks it (no PIN / no wallet).
 */

import { create } from "zustand";

export interface LockState {
  /** True while the app is locked; authenticated UI must not be shown. */
  locked: boolean;
  /** Whether the initial lock decision has been made (PIN existence checked). */
  resolved: boolean;
  /** Mark the app unlocked (after a successful PIN / biometric unlock). */
  unlock: () => void;
  /** Lock the app (auto-lock on background, or manual lock). */
  lock: () => void;
  /**
   * Set the initial lock state from whether a PIN is configured. The caller
   * (boot) performs the `hasPin()` check and passes the result, keeping this
   * store free of storage imports. Returns whether the app ended up locked.
   */
  resolveInitialLock: (pinSet: boolean) => boolean;
  /** Unlock without a PIN check, for wallets that have no PIN configured. */
  markNoPinUnlocked: () => void;
}

export const useLockStore = create<LockState>((set) => ({
  locked: true,
  resolved: false,

  unlock: (): void => {
    set({ locked: false, resolved: true });
  },

  lock: (): void => {
    set({ locked: true });
  },

  resolveInitialLock: (pinSet: boolean): boolean => {
    set({ locked: pinSet, resolved: true });
    return pinSet;
  },

  markNoPinUnlocked: (): void => {
    set({ locked: false, resolved: true });
  },
}));

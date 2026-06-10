/**
 * Pure policy for the persistent PIN-attempt tracker (N-3).
 *
 * Lives in its own module — separate from `pin-attempts.ts` which depends
 * on the platform key-value store — so the back-off math can be unit-tested
 * without dragging the React Native storage adapter into the bun test
 * runner (which cannot load `react-native/index.js`).
 *
 * Brute-force-defence contract:
 *   - The first {@link PIN_MAX_ATTEMPTS} failed PINs cost nothing (a user
 *     who mistypes once or twice doesn't get penalised).
 *   - The Nth failure (N ≥ PIN_MAX_ATTEMPTS) triggers a lockout window.
 *   - Each subsequent failure DOUBLES the lockout, capped at
 *     {@link PIN_MAX_LOCKOUT_SECONDS}.
 *   - The counter only resets on a SUCCESSFUL unlock (caller's job, e.g.
 *     `clearPinAttempts()` from `pin-attempts.ts`), NOT when a lockout
 *     timer expires — so an attacker can't sit on the timer and loop.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Persisted PIN gate state. Both fields default to zero (no failures, not
 * locked) when the store is empty.
 */
export interface PinAttemptState {
  /**
   * Count of consecutive failed PIN verifications since the last success.
   * Reset to 0 on a successful unlock (NOT when a lockout window expires).
   */
  readonly failedAttempts: number;
  /**
   * Unix epoch milliseconds at which the lockout expires. 0 means the user
   * is not currently locked out. The lockout is the wall-clock deadline,
   * not a duration — surviving a force-quit is the entire point.
   */
  readonly lockedUntil: number;
}

// ---------------------------------------------------------------------------
// Policy knobs
// ---------------------------------------------------------------------------

/**
 * Number of failures that triggers the first lockout window. Picked to match
 * the legacy in-memory counter so existing UI strings stay accurate.
 */
export const PIN_MAX_ATTEMPTS = 5;

/**
 * Base lockout duration (seconds). Doubles each time the user passes a
 * lockout and fails again — see {@link computeNextPinAttemptState}.
 */
export const PIN_BASE_LOCKOUT_SECONDS = 30;

/**
 * Hard cap on the lockout duration so back-off doesn't grow without bound
 * (and the user always has a chance to recover from a mistyped PIN).
 */
export const PIN_MAX_LOCKOUT_SECONDS = 60 * 60; // 1 hour

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Compute the lockout window (seconds) for a given total failure count.
 * Exponential back-off in powers of two beyond the first lockout, capped at
 * {@link PIN_MAX_LOCKOUT_SECONDS}.
 */
export function lockoutSecondsForAttempts(failedAttempts: number): number {
  if (failedAttempts < PIN_MAX_ATTEMPTS) return 0;
  const overflow = failedAttempts - PIN_MAX_ATTEMPTS;
  // 0 extra failures (we just crossed the threshold) → base lockout.
  // Each additional triggered lockout doubles the wait.
  const factor = 1 << Math.min(overflow, 20); // clamp to safe shift range
  const seconds = PIN_BASE_LOCKOUT_SECONDS * factor;
  return Math.min(seconds, PIN_MAX_LOCKOUT_SECONDS);
}

/**
 * Pure state-machine: given the current persisted state and a wall-clock
 * timestamp, return the state to persist after one failed attempt.
 */
export function computeNextPinAttemptState(
  current: PinAttemptState,
  nowMs: number,
): PinAttemptState {
  const failedAttempts = current.failedAttempts + 1;
  let lockedUntil = current.lockedUntil;
  if (failedAttempts >= PIN_MAX_ATTEMPTS) {
    const seconds = lockoutSecondsForAttempts(failedAttempts);
    lockedUntil = nowMs + seconds * 1000;
  }
  return { failedAttempts, lockedUntil };
}

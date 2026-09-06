// Amount helpers over FairCoin base units (m⊜). One coin is UNITS_PER_COIN
// base units. Amounts move through the system as bigint conceptually; the
// PaymentIntent DTO stores them as a base-unit integer string so no float ever
// touches a monetary value.

// Frozen FairCoin consensus constant (smallest units per FAIR). Mirrors
// @fairco.in/core's branding.ts; inlined here (rather than imported) to keep
// @peable.to/shared-types zero-runtime-dep for a clean CJS+ESM publish — must
// stay a bigint, never converted to number.
export const UNITS_PER_COIN = 100_000_000n;

/**
 * True only for a canonical non-negative integer string in base units:
 * one or more decimal digits, no sign, no decimal point, no leading zeros
 * (except the literal "0"). Floats and negatives are rejected.
 */
export function isBaseUnitString(s: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(s);
}

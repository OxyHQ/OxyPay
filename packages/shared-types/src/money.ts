// Amount helpers. Every monetary value moves through this gateway as a
// canonical integer string in the currency's SMALLEST unit — m⊜ for FairCoin,
// cents for a fiat currency — so no float ever touches one.

/**
 * The currencies this gateway can denominate a payment in.
 *
 * A closed set, and the database mirrors it as a CHECK
 * (`db/schema/valueSets.ts`). ADR 0001 D4: the scale of an amount is a property
 * of its currency and is NOT implied by the field's type, which is why
 * {@link CURRENCY_DECIMALS} exists and why {@link UNITS_PER_COIN} must never be
 * used to interpret a fiat amount.
 */
export const CURRENCY_CODES = ['FAIR', 'EUR', 'USD'] as const;

export type CurrencyCode = (typeof CURRENCY_CODES)[number];

/** Whether an arbitrary string is a currency this gateway knows. */
export function isCurrencyCode(value: string): value is CurrencyCode {
  return (CURRENCY_CODES as readonly string[]).includes(value);
}

/**
 * How many decimal places each currency's smallest unit represents — i.e. an
 * amount of `1` means `10^-decimals` of one whole unit.
 *
 * FairCoin's 8 is a consensus constant and is pinned against
 * {@link UNITS_PER_COIN} by this package's own tests, so the two spellings of
 * one fact cannot drift.
 */
export const CURRENCY_DECIMALS: Readonly<Record<CurrencyCode, number>> = Object.freeze({
  FAIR: 8,
  EUR: 2,
  USD: 2,
});

/** The decimal places of `currency`'s smallest unit. */
export function decimalsFor(currency: CurrencyCode): number {
  return CURRENCY_DECIMALS[currency];
}

// Frozen FairCoin consensus constant (smallest units per FAIR). Mirrors
// @fairco.in/core's branding.ts; inlined here (rather than imported) to keep
// @peable.to/shared-types zero-runtime-dep for a clean CJS+ESM publish — must
// stay a bigint, never converted to number.
//
// FAIRCOIN ONLY. A fiat amount has its own scale (`CURRENCY_DECIMALS`), and
// dividing a EUR amount by this constant is off by six orders of magnitude with
// nothing failing.
export const UNITS_PER_COIN = 100_000_000n;

/**
 * True only for a canonical non-negative integer string in the currency's
 * smallest unit: one or more decimal digits, no sign, no decimal point, no
 * leading zeros (except the literal "0"). Floats and negatives are rejected.
 *
 * Currency-agnostic on purpose — the pattern is about the SPELLING of an
 * amount, not its scale, and the same one is restated as a CHECK in the
 * database (`BASE_UNIT_STRING_PATTERN`), byte-identical.
 */
export function isBaseUnitString(s: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(s);
}

/**
 * Supported currencies. `FAIR` is the native FairCoin currency. The fiat
 * currencies are stored as references and quoted against `FAIR` at the
 * exchange-rate of the moment.
 */
export type Currency =
  | 'FAIR'
  | 'EUR'
  | 'USD'
  | 'GBP'
  | 'JPY'
  | 'CNY'
  | 'AUD'
  | 'CAD'
  | 'INR';

/**
 * A monetary amount.
 *
 * `amount` is stored as a fixed-precision string in the smallest unit of
 * the currency (cents for fiat, satoshi-equivalents for FAIR — 1 FAIR =
 * 1e8 base units). Strings avoid JS floating-point loss in financial
 * arithmetic.
 */
export interface Money {
  amount: string;
  currency: Currency;
}

/** Decimal places per currency used to format / parse `Money.amount`. */
export const CURRENCY_DECIMALS: Record<Currency, number> = {
  FAIR: 8,
  EUR: 2,
  USD: 2,
  GBP: 2,
  JPY: 0,
  CNY: 2,
  AUD: 2,
  CAD: 2,
  INR: 2,
};

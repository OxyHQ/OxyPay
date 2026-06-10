import BigNumber from 'bignumber.js';
import { CURRENCY_DECIMALS, type Currency, type Money } from '@oxypay/shared-types';

/**
 * Money is stored as a fixed-precision decimal string in the smallest unit of
 * the currency. These helpers keep arithmetic exact.
 */
export const zero = (currency: Currency): Money => ({ amount: '0', currency });

export const fromDecimal = (decimal: string | number, currency: Currency): Money => {
  const bn = new BigNumber(decimal).shiftedBy(CURRENCY_DECIMALS[currency]);
  if (!bn.isFinite() || bn.isNaN()) {
    throw new Error(`fromDecimal: invalid number ${decimal}`);
  }
  return { amount: bn.integerValue(BigNumber.ROUND_HALF_UP).toFixed(0), currency };
};

export const toDecimal = (money: Money): string => {
  return new BigNumber(money.amount).shiftedBy(-CURRENCY_DECIMALS[money.currency]).toFixed(CURRENCY_DECIMALS[money.currency]);
};

export const add = (a: Money, b: Money): Money => {
  ensureSameCurrency(a, b);
  return { amount: new BigNumber(a.amount).plus(b.amount).toFixed(0), currency: a.currency };
};

export const sub = (a: Money, b: Money): Money => {
  ensureSameCurrency(a, b);
  const result = new BigNumber(a.amount).minus(b.amount);
  return { amount: result.toFixed(0), currency: a.currency };
};

export const eq = (a: Money, b: Money): boolean => {
  ensureSameCurrency(a, b);
  return new BigNumber(a.amount).eq(b.amount);
};

export const gte = (a: Money, b: Money): boolean => {
  ensureSameCurrency(a, b);
  return new BigNumber(a.amount).gte(b.amount);
};

export const isPositive = (m: Money): boolean => new BigNumber(m.amount).gt(0);
export const isNonNegative = (m: Money): boolean => new BigNumber(m.amount).gte(0);

function ensureSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

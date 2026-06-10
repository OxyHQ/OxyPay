import { CURRENCY_DECIMALS, type Currency, type Money } from '@oxypay/shared-types';

const SYMBOLS: Record<Currency, string> = {
  FAIR: '\u229c',
  EUR: '\u20ac',
  USD: '$',
  GBP: '\u00a3',
  JPY: '\u00a5',
  CNY: '\u00a5',
  AUD: 'A$',
  CAD: 'C$',
  INR: '\u20b9',
};

const PRETTY: Record<Currency, string> = {
  FAIR: 'FairCoin',
  EUR: 'Euro',
  USD: 'US Dollar',
  GBP: 'British Pound',
  JPY: 'Japanese Yen',
  CNY: 'Chinese Yuan',
  AUD: 'Australian Dollar',
  CAD: 'Canadian Dollar',
  INR: 'Indian Rupee',
};

export const currencySymbol = (c: Currency): string => SYMBOLS[c];
export const currencyName = (c: Currency): string => PRETTY[c];

/**
 * Convert base-unit `Money` (e.g. cents) into a localised display string with
 * the correct number of decimals.
 */
export function formatMoney(money: Money, locale = 'en-US'): string {
  const decimals = CURRENCY_DECIMALS[money.currency];
  const big = BigInt(money.amount);
  const negative = big < 0n;
  const abs = negative ? -big : big;
  const padded = abs.toString().padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals) || '0';
  const fracPart = decimals > 0 ? padded.slice(-decimals) : '';
  const intWithThousands = Number.parseInt(intPart, 10).toLocaleString(locale);
  const sign = negative ? '-' : '';
  if (!decimals) return `${sign}${SYMBOLS[money.currency]}${intWithThousands}`;
  return `${sign}${SYMBOLS[money.currency]}${intWithThousands}.${fracPart}`;
}

/**
 * Parse a user-entered decimal string (e.g. "12.34") into base units.
 */
export function parseDecimalToBaseUnits(input: string, currency: Currency): string {
  const decimals = CURRENCY_DECIMALS[currency];
  const cleaned = input.replace(/[^0-9.]/g, '').replace(/(\..*?)\..*/g, '$1');
  if (!cleaned) return '0';
  const [intPart, fracPart = ''] = cleaned.split('.');
  const fracPadded = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  const all = `${intPart || '0'}${fracPadded}`.replace(/^0+(?=\d)/, '');
  return all || '0';
}

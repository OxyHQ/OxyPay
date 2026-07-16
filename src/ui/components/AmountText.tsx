/**
 * AmountText — a Text component that renders a FAIR amount (in smallest
 * units / bigint) with thousands separators and trimmed trailing zeros.
 *
 * Use this anywhere you display a FAIR amount in read-only mode (balance,
 * activity rows, transaction details, totals, etc).
 */

import { Text, type TextProps } from "react-native";
import { NumericFormat } from "react-number-format";
import { UNITS_PER_COIN } from "@fairco.in/core";

export interface AmountTextProps extends Omit<TextProps, "children"> {
  /** Amount in smallest units (m⊜). */
  value: bigint;
  /** Whether to keep trailing decimal zeros (default: false → trimmed). */
  fixedDecimalScale?: boolean;
  /** Number of decimal places to display (default: 8). */
  decimalScale?: number;
  /** Suffix appended after the amount, e.g. " ⊜" or " FAIR". */
  suffix?: string;
  /** Prefix prepended before the amount. */
  prefix?: string;
}

/**
 * Convert a bigint smallest-unit (m⊜) amount to a full-precision FAIR
 * decimal string. Uses string arithmetic to avoid the precision loss of
 * `Number(bigint)` for very large amounts.
 */
function unitsToDecimalString(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / UNITS_PER_COIN;
  const frac = abs % UNITS_PER_COIN;
  const fracStr = frac.toString().padStart(8, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fracStr}`;
}

export function AmountText({
  value,
  fixedDecimalScale = false,
  decimalScale = 8,
  suffix,
  prefix,
  ...rest
}: AmountTextProps) {
  let decimalString = unitsToDecimalString(value);
  if (!fixedDecimalScale) {
    // `unitsToDecimalString` always emits 8 fraction digits; strip trailing
    // zeros (and a bare trailing dot) so read-only amounts render compactly
    // (`0` not `0.00000000`, `1.5` not `1.50000000`). Only zeros AFTER the
    // decimal point are removed — the whole part is never touched.
    decimalString = decimalString
      .replace(/(\.\d*?)0+$/, "$1")
      .replace(/\.$/, "");
  }

  return (
    <NumericFormat
      value={decimalString}
      displayType="text"
      thousandSeparator=","
      decimalSeparator="."
      decimalScale={decimalScale}
      fixedDecimalScale={fixedDecimalScale}
      prefix={prefix}
      suffix={suffix}
      valueIsNumericString
      renderText={(formatted) => <Text {...rest}>{formatted}</Text>}
    />
  );
}

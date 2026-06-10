import { View, Text, StyleSheet } from 'react-native';
import type { Money } from '@oxypay/shared-types';
import { CURRENCY_DECIMALS } from '@oxypay/shared-types';
import { currencySymbol } from '@/utils/money';
import { useColors } from '@/hooks/useColors';

interface BalanceDisplayProps {
  balance: Money;
  /** Small caption above the balance (e.g. "Oxy Cash"). */
  label?: string;
}

/**
 * Cash App-style large balance display. Splits the amount into a giant
 * integer part and a smaller decimal part so the eye lands on the dollar
 * amount first.
 */
export function BalanceDisplay({ balance, label }: BalanceDisplayProps) {
  const colors = useColors();
  const decimals = CURRENCY_DECIMALS[balance.currency];
  const big = BigInt(balance.amount);
  const negative = big < 0n;
  const abs = negative ? -big : big;
  const padded = abs.toString().padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals) || '0';
  const fracPart = decimals > 0 ? padded.slice(-decimals).slice(0, 2) : '';

  const intDisplay = Number.parseInt(intPart, 10).toLocaleString('en-US');

  return (
    <View style={styles.wrap} accessibilityRole="text">
      {label ? <Text style={[styles.label, { color: colors.icon }]}>{label}</Text> : null}
      <View style={styles.row}>
        <Text style={[styles.symbol, { color: colors.text }]}>{currencySymbol(balance.currency)}</Text>
        <Text style={[styles.int, { color: colors.text }]}>
          {negative ? '\u2212' : ''}
          {intDisplay}
        </Text>
        {fracPart ? <Text style={[styles.frac, { color: colors.text }]}>.{fracPart}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 8 },
  label: { fontSize: 13, fontWeight: '500', letterSpacing: 0.4, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  symbol: { fontSize: 48, fontWeight: '700', marginTop: 12, marginRight: 4 },
  int: { fontSize: 80, fontWeight: '800', letterSpacing: -2, fontVariant: ['tabular-nums'] },
  frac: { fontSize: 40, fontWeight: '600', marginTop: 20, marginLeft: 2, fontVariant: ['tabular-nums'] },
});

import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { Transaction } from '@oxypay/shared-types';
import { formatMoney } from '@/utils/money';
import { useColors } from '@/hooks/useColors';

const INCOMING = new Set(['deposit', 'transfer_in', 'payment_in', 'refund_in']);

const ICONS: Record<Transaction['type'], keyof typeof Ionicons.glyphMap> = {
  deposit: 'arrow-down-circle',
  withdrawal: 'arrow-up-circle',
  transfer_in: 'arrow-down',
  transfer_out: 'arrow-up',
  payment_in: 'cart',
  payment_out: 'card',
  refund_in: 'refresh',
  refund_out: 'refresh',
  fee: 'pricetag',
};

interface ActivityRowProps {
  tx: Transaction;
  onPress?: () => void;
}

/**
 * Cash App-style activity row. Avatar / icon, primary title, timestamp,
 * monospaced amount on the right (green for incoming, neutral for outgoing).
 */
export function ActivityRow({ tx, onPress }: ActivityRowProps) {
  const colors = useColors();
  const { t } = useTranslation();
  const incoming = INCOMING.has(tx.type);
  const sign = incoming ? '+' : '\u2212';
  const amountColor = incoming ? colors.success : colors.text;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
    >
      <View style={[styles.avatar, { backgroundColor: colors.primarySubtle }]}>
        <Ionicons name={ICONS[tx.type] ?? 'pricetag'} size={20} color={colors.primarySubtleForeground} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {t(`history.types.${tx.type}`, { name: tx.counterpartyUsername ?? '\u2014' })}
        </Text>
        <Text style={[styles.timestamp, { color: colors.icon }]} numberOfLines={1}>
          {formatRelative(tx.createdAt)}
          {tx.note ? ` \u00b7 ${tx.note}` : ''}
        </Text>
      </View>
      <Text style={[styles.amount, { color: amountColor }]}>
        {sign} {formatMoney(tx.amount)}
      </Text>
    </Pressable>
  );
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: '500' },
  timestamp: { fontSize: 12 },
  amount: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
});

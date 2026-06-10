import { useState } from 'react';
import { View, FlatList, RefreshControl, StyleSheet, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

import { SignInGate } from '@/components/SignInGate';
import { ActivityRow } from '@/components/activity/ActivityRow';
import { useColors } from '@/hooks/useColors';
import { useTransactions } from '@/hooks/queries/useTransactions';
import type { Transaction } from '@oxypay/shared-types';

type Filter = 'all' | 'in' | 'out';

const INCOMING = new Set(['deposit', 'transfer_in', 'payment_in', 'refund_in']);

export default function ActivityScreen() {
  return (
    <SignInGate>
      <Activity />
    </SignInGate>
  );
}

function Activity() {
  const colors = useColors();
  const { t } = useTranslation();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const query = useTransactions();

  const items = (query.data?.pages.flatMap((p) => p.items) ?? []).filter((tx: Transaction) => {
    if (filter === 'all') return true;
    if (filter === 'in') return INCOMING.has(tx.type);
    return !INCOMING.has(tx.type);
  });

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <Text style={[styles.h1, { color: colors.text }]}>{t('activity.title')}</Text>
        <View style={styles.tabs}>
          {(['all', 'in', 'out'] as const).map((key) => (
            <Pressable
              key={key}
              onPress={() => setFilter(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: filter === key }}
              style={({ pressed }) => [
                styles.tabChip,
                {
                  backgroundColor: filter === key ? colors.primary : colors.primarySubtle,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text
                style={{
                  color: filter === key ? '#fff' : colors.text,
                  fontWeight: '600',
                  fontSize: 13,
                }}
              >
                {t(`activity.filter${key === 'all' ? 'All' : key === 'in' ? 'In' : 'Out'}`)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={(tx) => tx.id}
        renderItem={({ item }) => (
          <View style={styles.rowWrap}>
            <ActivityRow tx={item} onPress={() => router.push(`/tx/${item.id}` as never)} />
          </View>
        )}
        ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: colors.border }]} />}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={{ color: colors.icon }}>
              {query.isLoading ? t('activity.loading') : t('activity.empty')}
            </Text>
          </View>
        }
        ListFooterComponent={
          query.hasNextPage ? (
            <Pressable
              onPress={() => query.fetchNextPage()}
              accessibilityRole="button"
              style={styles.loadMore}
              disabled={query.isFetchingNextPage}
            >
              <Text style={{ color: colors.primary, fontWeight: '600' }}>
                {query.isFetchingNextPage ? t('activity.loading') : t('activity.loadMore')}
              </Text>
            </Pressable>
          ) : null
        }
        contentContainerStyle={items.length === 0 ? styles.center : { paddingHorizontal: 20 }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { padding: 20, gap: 12 },
  h1: { fontSize: 28, fontWeight: '700' },
  tabs: { flexDirection: 'row', gap: 8 },
  tabChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  rowWrap: { paddingHorizontal: 0 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 52 },
  empty: { padding: 48, alignItems: 'center' },
  loadMore: { padding: 16, alignItems: 'center' },
  center: { flexGrow: 1, justifyContent: 'center' },
});

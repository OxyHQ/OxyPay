import { useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { SignInGate } from '@/components/SignInGate';
import { BalanceDisplay } from '@/components/ui/BalanceDisplay';
import { PrimaryPillButton } from '@/components/ui/PrimaryPillButton';
import { ActivityRow } from '@/components/activity/ActivityRow';
import { useColors } from '@/hooks/useColors';
import { useWallets, useCreateWallet } from '@/hooks/queries/useWallets';
import { useTransactions } from '@/hooks/queries/useTransactions';
import type { Money, Wallet } from '@oxypay/shared-types';

export default function HomeScreen() {
  return (
    <SignInGate>
      <Home />
    </SignInGate>
  );
}

function Home() {
  const colors = useColors();
  const router = useRouter();
  const { t } = useTranslation();
  const wallets = useWallets();
  const transactions = useTransactions();
  const createWallet = useCreateWallet();

  const primaryWallet = useMemo<Wallet | undefined>(() => {
    const list = wallets.data?.wallets ?? [];
    return list.find((w) => w.currency === 'FAIR') ?? list[0];
  }, [wallets.data]);

  const balance: Money = primaryWallet?.balance ?? { amount: '0', currency: 'FAIR' };
  const recent = transactions.data?.pages[0]?.items ?? [];

  const onRefresh = useCallback(() => {
    wallets.refetch();
    transactions.refetch();
  }, [wallets, transactions]);

  // Bootstrap a FAIR wallet on first sign-in so the empty-state friction
  // disappears (Cash App does the same).
  if (wallets.data && wallets.data.wallets.length === 0 && !createWallet.isPending) {
    createWallet.mutate('FAIR');
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={wallets.isRefetching} onRefresh={onRefresh} />}
      >
        <View style={styles.balanceWrap}>
          <BalanceDisplay balance={balance} label={t('home.label')} />
        </View>

        <View style={styles.pillRow}>
          <PrimaryPillButton
            label={t('home.addCash')}
            onPress={() => router.push('/receive')}
            variant="primary"
            style={styles.pill}
          />
          <PrimaryPillButton
            label={t('home.cashOut')}
            onPress={() => router.push('/cash-out')}
            variant="secondary"
            style={styles.pill}
          />
        </View>

        {Platform.OS !== 'web' ? (
          <View style={styles.tapWrap}>
            <PrimaryPillButton
              label={t('home.tapToPay')}
              onPress={() => router.push('/tap-to-pay')}
              variant="secondary"
            />
          </View>
        ) : null}

        <View style={styles.activitySection}>
          <Text style={[styles.sectionTitle, { color: colors.icon }]}>
            {t('home.recentActivity').toUpperCase()}
          </Text>
          {recent.length === 0 ? (
            <View style={styles.empty}>
              <Text style={{ color: colors.icon }}>{t('home.noActivity')}</Text>
            </View>
          ) : (
            <View style={styles.activityList}>
              {recent.slice(0, 6).map((tx, idx, arr) => (
                <View
                  key={tx.id}
                  style={
                    idx < arr.length - 1
                      ? { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }
                      : undefined
                  }
                >
                  <ActivityRow tx={tx} onPress={() => router.push(`/tx/${tx.id}` as never)} />
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 80 },
  balanceWrap: { alignItems: 'center', marginVertical: 24 },
  pillRow: { flexDirection: 'row', gap: 12, justifyContent: 'center', marginTop: 8 },
  pill: { flex: 1, maxWidth: 220 },
  tapWrap: { alignItems: 'center', marginTop: 16 },
  activitySection: { marginTop: 40, gap: 12 },
  sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  empty: { padding: 32, alignItems: 'center' },
  activityList: { gap: 0 },
});

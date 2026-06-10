import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useTranslation } from 'react-i18next';
import QRCode from 'react-native-qrcode-svg';

import { SignInGate } from '@/components/SignInGate';
import { PrimaryPillButton } from '@/components/ui/PrimaryPillButton';
import { useColors } from '@/hooks/useColors';
import { useFairCoinAddress } from '@/hooks/queries/useFairCoinAddress';
import { useOxy } from '@oxyhq/services';

type Tab = 'cashtag' | 'faircoin';

export default function ReceiveScreen() {
  return (
    <SignInGate>
      <Receive />
    </SignInGate>
  );
}

function Receive() {
  const colors = useColors();
  const { t } = useTranslation();
  const { user } = useOxy();
  const address = useFairCoinAddress();
  const [tab, setTab] = useState<Tab>('cashtag');

  const cashtag = `$${user?.username ?? 'oxy'}`;
  const value = tab === 'cashtag' ? `oxypay://pay?to=${user?.id ?? ''}` : address.data?.address ?? '';

  const copy = async () => {
    await Clipboard.setStringAsync(tab === 'cashtag' ? cashtag : address.data?.address ?? '');
    if (Platform.OS === 'web') {
      window.alert(t('receive.copied'));
    } else {
      Alert.alert(t('receive.copied'));
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['bottom']}>
      <View style={styles.tabs}>
        <TabChip label={t('receive.username')} active={tab === 'cashtag'} onPress={() => setTab('cashtag')} />
        <TabChip label={t('receive.topUpFaircoin')} active={tab === 'faircoin'} onPress={() => setTab('faircoin')} />
      </View>

      <View style={styles.qrWrap}>
        {value ? (
          <View style={[styles.qrCard, { backgroundColor: '#fff' }]}>
            <QRCode value={value} size={220} />
          </View>
        ) : (
          <Text style={{ color: colors.icon }}>{t('receive.loadingAddress')}</Text>
        )}
        <Text style={[styles.address, { color: colors.text }]} selectable>
          {tab === 'cashtag' ? cashtag : address.data?.address ?? '\u2014'}
        </Text>
        <Text style={{ color: colors.icon, fontSize: 12, marginTop: 4 }}>
          {tab === 'cashtag' ? t('receive.yourQR') : t('receive.depositAddress')}
        </Text>
      </View>

      <View style={styles.actions}>
        <PrimaryPillButton label={t('receive.copy')} onPress={copy} variant="primary" />
      </View>
    </SafeAreaView>
  );
}

function TabChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.tabChip,
        {
          backgroundColor: active
            ? colors.primary
            : colors.primarySubtle,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Ionicons name={active ? 'qr-code' : 'qr-code-outline'} size={16} color={active ? '#fff' : colors.primary} />
      <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, padding: 20, gap: 24 },
  tabs: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  tabChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },
  qrWrap: { alignItems: 'center', gap: 12 },
  qrCard: { padding: 16, borderRadius: 24 },
  address: { fontSize: 14, fontWeight: '500', letterSpacing: 0.5, textAlign: 'center', marginTop: 8 },
  actions: { alignItems: 'center', marginTop: 'auto' },
});

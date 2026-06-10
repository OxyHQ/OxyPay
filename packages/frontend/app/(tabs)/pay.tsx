import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { SignInGate } from '@/components/SignInGate';
import { PrimaryPillButton } from '@/components/ui/PrimaryPillButton';
import { useColors } from '@/hooks/useColors';
import { useTransfer } from '@/hooks/queries/usePayments';
import { parseDecimalToBaseUnits, currencySymbol } from '@/utils/money';
import type { Currency } from '@oxypay/shared-types';

export default function PayScreen() {
  return (
    <SignInGate>
      <Pay />
    </SignInGate>
  );
}

function Pay() {
  const colors = useColors();
  const { t } = useTranslation();
  const transfer = useTransfer();

  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [note, setNote] = useState('');
  const [intent, setIntent] = useState<'pay' | 'request'>('pay');
  const currency: Currency = 'FAIR';

  const submit = async () => {
    if (!amount || !recipient.trim()) return;
    if (intent === 'request') {
      Alert.alert('Coming soon', 'Requests are not implemented yet.');
      return;
    }
    try {
      await transfer.mutateAsync({
        toUserId: recipient.replace(/^[@$]/, '').trim(),
        amount: { amount: parseDecimalToBaseUnits(amount, currency), currency },
        note: note.trim() || undefined,
      });
      setAmount('');
      setRecipient('');
      setNote('');
    } catch (err) {
      Alert.alert('Error', (err as Error).message);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
        keyboardVerticalOffset={40}
      >
        <View style={styles.amountWrap}>
          <View style={styles.amountRow}>
            <Text style={[styles.amountSymbol, { color: colors.text }]}>{currencySymbol(currency)}</Text>
            <TextInput
              style={[styles.amountInput, { color: colors.text }]}
              value={amount}
              onChangeText={(s) => setAmount(s.replace(/[^0-9.]/g, ''))}
              placeholder="0"
              placeholderTextColor={colors.icon}
              keyboardType="decimal-pad"
              autoFocus
              maxLength={9}
              returnKeyType="done"
            />
          </View>

          <View style={[styles.recipient, { borderColor: colors.border }]}>
            <Ionicons name="search" size={18} color={colors.icon} />
            <TextInput
              value={recipient}
              onChangeText={setRecipient}
              placeholder={t('pay.toPlaceholder') ?? ''}
              placeholderTextColor={colors.icon}
              style={[styles.input, { color: colors.text }]}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={[styles.noteWrap, { borderColor: colors.border }]}>
            <Ionicons name="pencil" size={18} color={colors.icon} />
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={t('pay.note') ?? ''}
              placeholderTextColor={colors.icon}
              style={[styles.input, { color: colors.text }]}
              maxLength={140}
            />
          </View>
        </View>

        <View style={styles.actions}>
          <ActionTab
            label={t('pay.actionRequest')}
            icon="arrow-down"
            active={intent === 'request'}
            onPress={() => setIntent('request')}
          />
          <ActionTab
            label={t('pay.actionPay')}
            icon="arrow-up"
            active={intent === 'pay'}
            onPress={() => setIntent('pay')}
          />
        </View>

        <View style={styles.submitWrap}>
          <PrimaryPillButton
            label={
              intent === 'pay'
                ? t('pay.submit', { amount: `${currencySymbol(currency)}${amount || '0'}` })
                : t('pay.submitRequest', { amount: `${currencySymbol(currency)}${amount || '0'}` })
            }
            onPress={submit}
            variant="primary"
            disabled={!amount || !recipient.trim() || transfer.isPending}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

interface ActionTabProps {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
}

function ActionTab({ label, icon, active, onPress }: ActionTabProps) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.actionTab,
        {
          backgroundColor: active ? colors.primary : colors.primarySubtle,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={18} color={active ? '#fff' : colors.primary} />
      <Text style={{ color: active ? '#fff' : colors.text, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  amountWrap: { flex: 1, alignItems: 'center', paddingTop: 36, gap: 20, paddingHorizontal: 24 },
  amountRow: { flexDirection: 'row', alignItems: 'flex-start', height: 110 },
  amountSymbol: { fontSize: 42, fontWeight: '700', marginTop: 18 },
  amountInput: {
    fontSize: 96,
    fontWeight: '700',
    minWidth: 90,
    padding: 0,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  recipient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 16,
    height: 48,
  },
  noteWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 16,
    height: 48,
  },
  input: { flex: 1, fontSize: 16, padding: 0 },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 12, paddingHorizontal: 24, marginTop: 8 },
  actionTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  submitWrap: { padding: 24, alignItems: 'center' },
});

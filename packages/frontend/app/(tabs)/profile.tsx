import { ScrollView, View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useOxy } from '@oxyhq/services';

import { SignInGate } from '@/components/SignInGate';
import { PrimaryPillButton } from '@/components/ui/PrimaryPillButton';
import { useColors } from '@/hooks/useColors';
import { useDevTopUp } from '@/hooks/queries/useWallets';

export default function ProfileScreen() {
  return (
    <SignInGate>
      <Profile />
    </SignInGate>
  );
}

function Profile() {
  const colors = useColors();
  const { t, i18n } = useTranslation();
  const { user, logout } = useOxy();
  const devTopUp = useDevTopUp();
  const isDev = process.env.NODE_ENV !== 'production';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.avatar}>
          <View style={[styles.avatarBubble, { backgroundColor: colors.primarySubtle }]}>
            <Text style={[styles.avatarLetter, { color: colors.primarySubtleForeground }]}>
              {(user?.username ?? user?.name?.first ?? '?')[0]?.toUpperCase()}
            </Text>
          </View>
          <Text style={[styles.name, { color: colors.text }]}>{user?.username ?? user?.name?.first ?? '\u2014'}</Text>
          <Text style={[styles.cashtag, { color: colors.icon }]}>
            ${user?.username ?? 'oxy'}
          </Text>
        </View>

        <Group colors={colors} title={t('profile.language')}>
          <Row label="English" active={i18n.language === 'en'} onPress={() => i18n.changeLanguage('en')} colors={colors} />
          <Row label="Español" active={i18n.language === 'es'} onPress={() => i18n.changeLanguage('es')} colors={colors} last />
        </Group>

        {isDev ? (
          <Group colors={colors} title={t('profile.devTopUpTitle')}>
            <Text style={{ color: colors.icon, fontSize: 12, marginBottom: 8 }}>
              {t('profile.devTopUpHint')}
            </Text>
            <PrimaryPillButton
              label={t('profile.devTopUp', { amount: 100, currency: 'FAIR' })}
              onPress={() =>
                devTopUp.mutate(
                  { currency: 'FAIR', amount: '100' },
                  {
                    onError: (e) => Alert.alert('Error', (e as Error).message),
                  }
                )
              }
              variant="secondary"
            />
          </Group>
        ) : null}

        <Group colors={colors} title={t('profile.about')}>
          <Text style={{ color: colors.icon }}>
            {t('profile.version', { version: Constants.expoConfig?.version ?? '0.1.0' })}
          </Text>
        </Group>

        <View style={styles.signOutWrap}>
          <PrimaryPillButton label={t('profile.signOut')} onPress={() => logout()} variant="secondary" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Group({
  title,
  children,
  colors,
}: {
  title: string;
  children: React.ReactNode;
  colors: { text: string; border: string; background: string };
}) {
  return (
    <View style={[styles.group, { borderColor: colors.border }]}>
      <Text style={[styles.groupTitle, { color: colors.text }]}>{title}</Text>
      {children}
    </View>
  );
}

function Row({
  label,
  active,
  onPress,
  colors,
  last,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  colors: { text: string; border: string; primary: string };
  last?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: last ? 'transparent' : colors.border, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Text style={{ color: colors.text, fontSize: 15 }}>{label}</Text>
      {active ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 20, gap: 20, paddingBottom: 80 },
  avatar: { alignItems: 'center', gap: 8, marginVertical: 16 },
  avatarBubble: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: { fontSize: 32, fontWeight: '700' },
  name: { fontSize: 18, fontWeight: '600' },
  cashtag: { fontSize: 14 },
  group: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  groupTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  signOutWrap: { alignItems: 'center', marginTop: 24 },
});

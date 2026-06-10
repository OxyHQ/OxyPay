import { Slot, usePathname, useRouter } from 'expo-router';
import { View, Pressable, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';

const TABS = [
  { key: 'index', path: '/', icon: 'cash-outline', iconActive: 'cash', i18n: 'tabs.money' },
  { key: 'pay', path: '/pay', icon: 'add-circle-outline', iconActive: 'add-circle', i18n: 'tabs.pay' },
  { key: 'activity', path: '/activity', icon: 'time-outline', iconActive: 'time', i18n: 'tabs.activity' },
  { key: 'profile', path: '/profile', icon: 'person-circle-outline', iconActive: 'person-circle', i18n: 'tabs.profile' },
] as const;

/**
 * Web bottom bar that mirrors the native tab layout. Kept inline (no Bloom
 * dependency) so the route file is the single source of truth for active
 * highlight + i18n.
 */
export default function TabsWebLayout() {
  const colors = useColors();
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useTranslation();

  return (
    <View style={[styles.shell, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <Slot />
      </View>
      <View
        style={[
          styles.bar,
          { borderTopColor: colors.border, backgroundColor: colors.background },
        ]}
      >
        {TABS.map((tab) => {
          const isActive =
            (tab.path === '/' && (pathname === '/' || pathname === '/index')) ||
            (tab.path !== '/' && pathname.startsWith(tab.path));
          const color = isActive ? colors.primary : colors.icon;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="button"
              accessibilityLabel={t(tab.i18n)}
              onPress={() => router.push(tab.path as never)}
              style={({ pressed }) => [styles.tab, { opacity: pressed ? 0.7 : 1 }]}
            >
              <Ionicons name={(isActive ? tab.iconActive : tab.icon) as never} size={24} color={color} />
              <Text style={[styles.tabLabel, { color }]}>{t(tab.i18n)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, height: '100%' },
  content: { flex: 1 },
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 8,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tab: { alignItems: 'center', gap: 2, paddingHorizontal: 12, minWidth: 64 },
  tabLabel: { fontSize: 11, fontWeight: '500' },
});

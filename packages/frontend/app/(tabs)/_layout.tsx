import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useTranslation } from 'react-i18next';
import { useColors } from '@/hooks/useColors';

/**
 * Native tab bar (iOS/Android). On web the `_layout.web.tsx` sibling renders
 * a Cash App-style bottom bar built with `<Pressable>` so the same routes
 * work in browsers without `unstable-native-tabs`.
 */
export default function TabsLayout() {
  const colors = useColors();
  const { t } = useTranslation();

  return (
    <NativeTabs
      iconColor={{ default: colors.icon, selected: colors.primary }}
      labelStyle={{ default: { color: colors.icon }, selected: { color: colors.primary } }}
      tintColor={colors.primary}
      backgroundColor={colors.background}
      indicatorColor={colors.primarySubtle}
      rippleColor={colors.primarySubtle}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: 'dollarsign.circle', selected: 'dollarsign.circle.fill' }} md="payments" />
        <NativeTabs.Trigger.Label>{t('tabs.money')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="pay">
        <NativeTabs.Trigger.Icon sf={{ default: 'plus.circle', selected: 'plus.circle.fill' }} md="add_circle" />
        <NativeTabs.Trigger.Label>{t('tabs.pay')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="activity">
        <NativeTabs.Trigger.Icon sf={{ default: 'clock.arrow.circlepath', selected: 'clock.arrow.circlepath' }} md="history" />
        <NativeTabs.Trigger.Label>{t('tabs.activity')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} md="account_circle" />
        <NativeTabs.Trigger.Label>{t('tabs.profile')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

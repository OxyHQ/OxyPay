/**
 * Tab layout for Android and iOS using native system tab bar.
 * Background, tint, and icon colors all come from Bloom's theme.
 */

import { ThemeProvider } from "@react-navigation/native";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useMemo } from "react";
import { useTheme } from "@oxyhq/bloom/theme";
import { t } from "../../src/i18n";

export default function TabLayout() {
  const theme = useTheme();

  const navTheme = useMemo(
    () => ({
      dark: theme.isDark,
      fonts: {
        regular: { fontFamily: "System", fontWeight: "400" as const },
        medium: { fontFamily: "System", fontWeight: "500" as const },
        bold: { fontFamily: "System", fontWeight: "700" as const },
        heavy: { fontFamily: "System", fontWeight: "800" as const },
      },
      colors: {
        background: theme.colors.background,
        card: theme.colors.card,
        border: theme.colors.border,
        primary: theme.colors.tint,
        text: theme.colors.text,
        notification: theme.colors.error,
      },
    }),
    [theme],
  );

  return (
    <ThemeProvider value={navTheme}>
      <NativeTabs
        backgroundColor={theme.colors.card}
        tintColor={theme.colors.tint}
        indicatorColor={theme.colors.primarySubtle}
        iconColor={{
          default: theme.colors.icon,
          selected: theme.colors.tint,
        }}
        labelStyle={{
          color: theme.colors.textSecondary,
        }}
      >
        <NativeTabs.Trigger
          name="index"
          contentStyle={{ backgroundColor: theme.colors.background }}
        >
          <NativeTabs.Trigger.Icon
            sf={{ default: "creditcard", selected: "creditcard.fill" }}
            md="wallet"
          />
          <NativeTabs.Trigger.Label>{t("wallet.title")}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>

        <NativeTabs.Trigger
          name="map"
          contentStyle={{ backgroundColor: theme.colors.background }}
        >
          <NativeTabs.Trigger.Icon
            sf={{ default: "map", selected: "map.fill" }}
            md="map"
          />
          <NativeTabs.Trigger.Label>{t("wallet.places")}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>

        <NativeTabs.Trigger
          name="buy"
          contentStyle={{ backgroundColor: theme.colors.background }}
        >
          <NativeTabs.Trigger.Icon
            sf={{ default: "creditcard.and.123", selected: "creditcard.and.123" }}
            md="account_balance_wallet"
          />
          <NativeTabs.Trigger.Label>{t("wallet.buy")}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>

        <NativeTabs.Trigger
          name="settings"
          contentStyle={{ backgroundColor: theme.colors.background }}
        >
          <NativeTabs.Trigger.Icon
            sf={{ default: "gearshape", selected: "gearshape.fill" }}
            md="settings"
          />
          <NativeTabs.Trigger.Label>{t("wallet.settings")}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    </ThemeProvider>
  );
}

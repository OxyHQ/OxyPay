/**
 * Welcome screen — clean, minimal entry point for new users.
 */

import { useCallback, useMemo } from "react";
import { View, Text, Image, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "../../src/ui/safe-area-view";
import { Button } from "../../src/ui/components/Button";
import { FONT_PHUDU_BLACK } from "../../src/utils/fonts";
import { APP_NAME } from "@fairco.in/core";
import { findLanguageOption, t } from "../../src/i18n";
import { useLanguageStore } from "../../src/i18n/store";

export default function WelcomeScreen() {
  const router = useRouter();
  const language = useLanguageStore((s) => s.language);

  const currentLanguageOption = useMemo(
    () => findLanguageOption(language),
    [language],
  );

  const handleCreate = useCallback(() => {
    router.push("/onboarding/create");
  }, [router]);

  const handleRestore = useCallback(() => {
    router.push("/onboarding/restore");
  }, [router]);

  const handleLanguage = useCallback(() => {
    router.push("/language");
  }, [router]);

  return (
    <SafeAreaView className="flex-1 bg-background">
      {/* Top-right language pill */}
      <View className="flex-row justify-end px-4 pt-2">
        <Pressable
          onPress={handleLanguage}
          className="flex-row items-center bg-surface rounded-full px-3 py-2 active:opacity-80"
          accessibilityRole="button"
          accessibilityLabel={t("language.title")}
        >
          <Text className="text-lg mr-2" accessibilityElementsHidden>
            {currentLanguageOption?.flag ?? "\uD83C\uDDEC\uD83C\uDDE7"}
          </Text>
          <Text className="text-foreground text-sm font-medium">
            {currentLanguageOption?.nativeName ?? language}
          </Text>
        </Pressable>
      </View>

      <View className="flex-1 items-center justify-between px-8 pt-12 pb-10">
        {/* Brand */}
        <View className="flex-1 items-center justify-center">
          <Image
            source={require("../../assets/icon.png")}
            style={{ width: 128, height: 128, marginBottom: 24, borderRadius: 28 }}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
            accessibilityRole="image"
            accessibilityLabel={t("onboarding.logoAccessibility")}
          />
          <Text
            className="text-foreground text-4xl tracking-wider mb-3"
            style={{ fontFamily: FONT_PHUDU_BLACK }}
          >
            {APP_NAME}
          </Text>
          <Text className="text-muted-foreground text-base tracking-widest">
            {t("onboarding.tagline")}
          </Text>
        </View>

        {/* Actions */}
        <View className="w-full gap-4">
          <Button
            title={t("onboarding.createCta")}
            onPress={handleCreate}
            variant="primary"
            size="lg"
          />
          <Button
            title={t("onboarding.restoreCta")}
            onPress={handleRestore}
            variant="outline"
            size="lg"
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

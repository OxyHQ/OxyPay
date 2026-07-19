/**
 * Custom 404 / unmatched route screen.
 *
 * expo-router automatically renders this file for any URL that doesn't
 * resolve to a real route. Branded to match the rest of FAIRWallet.
 */

import { View, Text, Image, Pressable } from "react-native";
import { SafeAreaView } from "../src/ui/safe-area-view";
import { useRouter } from "expo-router";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useTheme } from "@oxyhq/bloom/theme";
import { Button } from "../src/ui/components/Button";
import { FONT_PHUDU_BLACK } from "../src/utils/fonts";
import { APP_DISPLAY_NAME } from "../src/config";
import { t } from "../src/i18n";

export default function NotFoundScreen() {
  const router = useRouter();
  const theme = useTheme();

  const handleGoHome = () => {
    router.replace("/(tabs)");
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      handleGoHome();
    }
  };

  return (
    <SafeAreaView
      className="flex-1 bg-background"
      edges={["top", "bottom", "left", "right"]}
    >
      <View className="flex-row items-center px-3 py-2">
        <Pressable
          onPress={handleBack}
          className="w-11 h-11 items-center justify-center rounded-full active:bg-surface"
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
        >
          <MaterialCommunityIcons
            name="arrow-left"
            size={24}
            color={theme.colors.text}
          />
        </Pressable>
      </View>

      <View className="flex-1 items-center justify-center px-8">
        <View className="w-24 h-24 rounded-full bg-primary/10 items-center justify-center mb-8">
          <MaterialCommunityIcons
            name="map-search-outline"
            size={48}
            color={theme.colors.primary}
          />
        </View>

        <Text
          className="text-foreground text-center mb-3"
          style={{ fontFamily: FONT_PHUDU_BLACK, fontSize: 28 }}
        >
          {t("notFound.title")}
        </Text>

        <Text className="text-muted-foreground text-base text-center mb-10 leading-6">
          {t("notFound.description")}
        </Text>

        <View className="w-full max-w-xs gap-3">
          <Button
            title={t("notFound.goHome")}
            onPress={handleGoHome}
            variant="primary"
            size="lg"
          />
        </View>
      </View>

      <View className="items-center pb-6">
        <Image
          source={require("../assets/icon.png")}
          style={{ width: 32, height: 32, borderRadius: 8, opacity: 0.4 }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
          accessibilityRole="image"
          accessibilityLabel={`${APP_DISPLAY_NAME} logo`}
        />
      </View>
    </SafeAreaView>
  );
}

/**
 * Restore wallet screen — clean mnemonic input with word count feedback.
 */

import { useCallback, useMemo, useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useWalletStore } from "../../src/wallet/wallet-store";
import { Button } from "../../src/ui/components/Button";
import { useTheme } from "@oxyhq/bloom/theme";
import { t } from "../../src/i18n";

export default function RestoreWalletScreen() {
  const router = useRouter();
  const restoreWallet = useWalletStore((s) => s.restoreWallet);
  const loading = useWalletStore((s) => s.loading);
  const theme = useTheme();

  const [mnemonicInput, setMnemonicInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const wordCount = useMemo(() => {
    const trimmed = mnemonicInput.trim();
    if (trimmed.length === 0) return 0;
    return trimmed.split(/\s+/).length;
  }, [mnemonicInput]);

  // Accept either standard BIP39 length. The store validates the full checksum
  // via `restoreWallet`, so the import modal (which already allows 12 or 24)
  // and this screen agree — a valid 12-word phrase is not rejected here (L5).
  const isValidCount = wordCount === 12 || wordCount === 24;

  const handlePaste = useCallback(async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text) {
        setMnemonicInput(text.trim());
        setError(null);
      }
    } catch {
      setError(t("onboarding.restore.error.clipboard"));
    }
  }, []);

  const handleRestore = useCallback(async () => {
    setError(null);
    try {
      await restoreWallet(mnemonicInput);
      router.replace("/onboarding/pin-setup");
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : t("onboarding.restore.error.failed");
      setError(msg);
    }
  }, [mnemonicInput, restoreWallet, router]);

  const wordCountColor = useMemo(() => {
    if (wordCount === 0) return "text-muted-foreground";
    if (isValidCount) return "text-primary";
    return "text-muted-foreground";
  }, [wordCount, isValidCount]);

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-6 pt-24 pb-10"
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <Text className="text-foreground text-xl font-bold mb-2 text-center">
          {t("onboarding.restore.title")}
        </Text>
        <Text className="text-muted-foreground text-sm mb-8 text-center leading-5">
          {t("onboarding.restore.description")}
        </Text>

        {/* Mnemonic input area */}
        <View className="bg-surface border border-border rounded-2xl p-5 mb-4">
          <TextInput
            className="text-foreground text-base leading-6 min-h-[140px] font-mono"
            placeholder={t("onboarding.restore.phrasePlaceholder")}
            placeholderTextColor={theme.colors.textSecondary}
            value={mnemonicInput}
            onChangeText={setMnemonicInput}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            textAlignVertical="top"
          />
        </View>

        {/* Word count + paste row */}
        <View className="flex-row items-center justify-between mb-6">
          <Text className={`text-sm font-medium ${wordCountColor}`}>
            {wordCount === 1
              ? t("onboarding.restore.wordCount.one", { count: wordCount })
              : t("onboarding.restore.wordCount.other", { count: wordCount })}
          </Text>
          <Pressable
            className="flex-row items-center gap-2 bg-surface border border-border rounded-full px-4 py-2 active:bg-primary/10"
            onPress={handlePaste}
          >
            <MaterialCommunityIcons
              name="content-paste"
              size={16}
              color={theme.colors.primary}
            />
            <Text className="text-primary text-sm font-medium">
              {t("onboarding.restore.pasteCta")}
            </Text>
          </Pressable>
        </View>

        {/* Validation error */}
        {error ? (
          <View className="flex-row items-start gap-3 bg-red-950/40 border border-red-600/30 rounded-2xl p-4 mb-6">
            <MaterialCommunityIcons
              name="alert-circle-outline"
              size={20}
              color={theme.colors.error}
            />
            <Text className="text-red-400 text-sm flex-1 leading-5">
              {error}
            </Text>
          </View>
        ) : null}

        {/* Restore button */}
        <Button
          title={t("onboarding.restoreCta")}
          onPress={handleRestore}
          variant="primary"
          size="lg"
          disabled={!isValidCount}
          loading={loading}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

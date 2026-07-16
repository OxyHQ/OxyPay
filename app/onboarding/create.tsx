/**
 * Create wallet flow — Revolut-inspired design.
 * Generates mnemonic, displays it in a clean grid, then verifies.
 */

import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "../../src/ui/safe-area-view";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useWalletStore } from "../../src/wallet/wallet-store";
import { Button } from "../../src/ui/components/Button";
import { Card } from "../../src/ui/components/Card";
import { useTheme } from "@oxyhq/bloom/theme";
import { hapticSuccess } from "../../src/utils/haptics";
import { COIN_SYMBOL } from "@fairco.in/core";
import { t } from "../../src/i18n";

type Step = "generating" | "display" | "verify" | "complete";

const VERIFY_COUNT = 3;
const TOTAL_STEPS = 3; // display → verify → pin-setup

function pickRandomIndices(total: number, count: number): number[] {
  const indices: number[] = [];
  while (indices.length < count) {
    const idx = Math.floor(Math.random() * total);
    if (!indices.includes(idx)) {
      indices.push(idx);
    }
  }
  return indices.sort((a, b) => a - b);
}

/** Fisher-Yates (Knuth) shuffle — unbiased in-place shuffle. */
function fisherYatesShuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
  }
  return result;
}

/** Build shuffled options for verification, ensuring the correct word is included. */
function buildShuffledOptions(words: string[], correctWord: string): string[] {
  const shuffled = fisherYatesShuffle(words).slice(0, 6);
  if (!shuffled.includes(correctWord)) {
    shuffled[0] = correctWord;
  }
  return fisherYatesShuffle(shuffled);
}

/** Renders step indicator dots. */
function StepIndicator({ total, current }: { total: number; current: number }) {
  return (
    <View className="flex-row justify-center gap-2 mb-8">
      {Array.from({ length: total }, (_, i) => (
        <View
          key={`step-${i}`}
          className={`h-1.5 rounded-full ${
            i <= current ? "bg-primary w-6" : "bg-surface w-3"
          }`}
        />
      ))}
    </View>
  );
}

export default function CreateWalletScreen() {
  const router = useRouter();
  const createWallet = useWalletStore((s) => s.createWallet);
  const theme = useTheme();

  const [step, setStep] = useState<Step>("generating");
  const [words, setWords] = useState<string[]>([]);
  const [verifyIndices, setVerifyIndices] = useState<number[]>([]);
  const [currentVerifyIdx, setCurrentVerifyIdx] = useState(0);
  const [shuffledOptions, setShuffledOptions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    try {
      const mnemonic = await createWallet();
      const wordList = mnemonic.split(" ");
      setWords(wordList);
      setStep("display");
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : t("onboarding.create.error.generate");
      setError(msg);
    }
  }, [createWallet]);

  const isGenerating = step === "generating";

  const handleWrittenDown = useCallback(() => {
    const indices = pickRandomIndices(words.length, VERIFY_COUNT);
    setVerifyIndices(indices);
    setCurrentVerifyIdx(0);

    const correctWord = words[indices[0]];
    setShuffledOptions(buildShuffledOptions(words, correctWord));
    setStep("verify");
  }, [words]);

  const handleVerifySelect = useCallback(
    (selectedWord: string) => {
      const expectedIdx = verifyIndices[currentVerifyIdx];
      const expectedWord = words[expectedIdx];

      if (selectedWord !== expectedWord) {
        setError(t("onboarding.create.verify.error"));
        return;
      }

      setError(null);
      const nextIdx = currentVerifyIdx + 1;

      if (nextIdx >= VERIFY_COUNT) {
        hapticSuccess();
        setStep("complete");
        router.replace("/onboarding/pin-setup");
        return;
      }

      setCurrentVerifyIdx(nextIdx);

      const nextCorrectWord = words[verifyIndices[nextIdx]];
      setShuffledOptions(buildShuffledOptions(words, nextCorrectWord));
    },
    [verifyIndices, currentVerifyIdx, words, router],
  );

  const currentVerifyPosition = useMemo(() => {
    if (verifyIndices.length === 0) return 0;
    return verifyIndices[currentVerifyIdx] + 1;
  }, [verifyIndices, currentVerifyIdx]);

  const currentStepIndex = useMemo(() => {
    if (step === "display") return 0;
    if (step === "verify") return 1;
    return 2;
  }, [step]);

  // -- Generate screen --
  if (isGenerating) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-primary text-5xl mb-8">{COIN_SYMBOL}</Text>

          {error ? (
            <>
              <Text className="text-red-400 text-base mb-6 text-center">
                {error}
              </Text>
              <Button
                title={t("common.retry")}
                onPress={handleGenerate}
                variant="primary"
              />
            </>
          ) : (
            <>
              <Text className="text-foreground text-xl font-semibold mb-3">
                {t("onboarding.create.heading")}
              </Text>
              <Text className="text-muted-foreground text-sm text-center mb-8">
                {t("onboarding.create.description")}
              </Text>
              <Button
                title={t("onboarding.create.generateCta")}
                onPress={handleGenerate}
                variant="primary"
                size="lg"
              />
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // -- Display mnemonic --
  if (step === "display") {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-6 pt-24 pb-10"
        >
          <StepIndicator total={TOTAL_STEPS} current={currentStepIndex} />

          <Text className="text-foreground text-xl font-bold mb-2 text-center">
            {t("onboarding.create.phrase.title")}
          </Text>
          <Text className="text-muted-foreground text-sm mb-8 text-center leading-5">
            {t("onboarding.create.phrase.description")}
          </Text>

          {/* 3-column word grid */}
          <View className="flex-row flex-wrap justify-between gap-y-3 mb-8 px-1">
            {words.map((word, idx) => (
              <Card
                key={`word-${idx}-${word}`}
                className="w-[31%] px-3 py-2.5"
              >
                <View className="flex-row items-baseline gap-1.5">
                  <Text className="text-muted-foreground text-xs">{idx + 1}</Text>
                  <Text className="text-foreground text-sm font-medium">{word}</Text>
                </View>
              </Card>
            ))}
          </View>

          {/* Warning */}
          <View className="flex-row items-start gap-3 bg-red-950/40 border border-red-600/30 rounded-2xl p-4 mb-8">
            <MaterialCommunityIcons
              name="alert-outline"
              size={20}
              color={theme.colors.error}
            />
            <Text className="text-red-400 text-sm flex-1 leading-5">
              {t("onboarding.create.phrase.warning")}
            </Text>
          </View>

          <Button
            title={t("onboarding.create.phrase.cta")}
            onPress={handleWrittenDown}
            variant="primary"
            size="lg"
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // -- Verification step --
  if (step === "verify") {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <View className="flex-1 px-6 pt-24">
          <StepIndicator total={TOTAL_STEPS} current={currentStepIndex} />

          <Text className="text-foreground text-xl font-bold mb-2 text-center">
            {t("onboarding.create.verify.title")}
          </Text>
          <Text className="text-muted-foreground text-sm mb-8 text-center">
            {t("onboarding.create.verify.prompt", {
              position: currentVerifyPosition,
            })}
          </Text>

          {/* Verification progress dots */}
          <View className="flex-row justify-center gap-3 mb-8">
            {verifyIndices.map((_, idx) => (
              <View
                key={`verify-progress-${idx}`}
                className={`w-2.5 h-2.5 rounded-full ${
                  idx < currentVerifyIdx
                    ? "bg-primary"
                    : idx === currentVerifyIdx
                      ? "bg-primary-dim"
                      : "bg-surface"
                }`}
              />
            ))}
          </View>

          {/* Error */}
          {error ? (
            <Text className="text-red-400 text-sm mb-4 text-center">
              {error}
            </Text>
          ) : null}

          {/* Word options — 3 per row */}
          <View className="flex-row flex-wrap justify-between gap-y-3">
            {shuffledOptions.map((option, idx) => (
              <Pressable
                key={`option-${idx}-${option}`}
                className="w-[31%] bg-surface border border-border rounded-2xl py-4 items-center active:border-primary active:bg-primary/10"
                onPress={() => handleVerifySelect(option)}
              >
                <Text className="text-foreground text-base font-medium">
                  {option}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // -- Complete (briefly shown before redirect) --
  return (
    <View className="flex-1 bg-background items-center justify-center">
      <ActivityIndicator size="large" color={theme.colors.primary} />
      <Text className="text-foreground text-base mt-4">
        {t("onboarding.create.settingUp")}
      </Text>
    </View>
  );
}

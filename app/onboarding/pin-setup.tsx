/**
 * PIN setup screen — Revolut-style passcode creation during onboarding.
 * Prompts user to set and confirm a 6-digit PIN.
 */

import { useCallback, useState } from "react";
import { View, Text, Image } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { savePin } from "../../src/storage/secure-store";
import { useLockStore } from "../../src/wallet/lock-store";
import { PinPad } from "../../src/ui/components/PinPad";
import { PinDots } from "../../src/ui/components/PinDots";
import { hapticSuccess } from "../../src/utils/haptics";
import { t } from "../../src/i18n";

const PIN_LENGTH = 6;

type PinPhase = "create" | "confirm";

export default function PinSetupScreen() {
  const router = useRouter();
  const unlock = useLockStore((s) => s.unlock);
  const [phase, setPhase] = useState<PinPhase>("create");
  const [pin, setPin] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const title =
    phase === "create"
      ? t("onboarding.pin.create.title")
      : t("onboarding.pin.confirm.title");
  const subtitle =
    phase === "create"
      ? t("onboarding.pin.create.subtitle")
      : t("onboarding.pin.confirm.subtitle");

  const handleDigitPress = useCallback(
    (digit: string) => {
      if (saving) return;

      setError(null);
      setPin((prev) => {
        if (prev.length >= PIN_LENGTH) return prev;
        const next = prev + digit;

        if (next.length === PIN_LENGTH) {
          if (phase === "create") {
            setTimeout(() => {
              setFirstPin(next);
              setPin("");
              setPhase("confirm");
            }, 200);
          } else {
            setTimeout(() => {
              if (next === firstPin) {
                hapticSuccess();
                setSaving(true);
                savePin(next)
                  .then(() => {
                    // The wallet was just created and is already initialized;
                    // the user explicitly set this PIN, so unlock immediately
                    // instead of letting the lock overlay shut them out.
                    unlock();
                    router.replace("/(tabs)");
                  })
                  .catch((err: unknown) => {
                    const msg =
                      err instanceof Error
                        ? err.message
                        : t("onboarding.pin.saveError");
                    setError(msg);
                    setSaving(false);
                    setPin("");
                  });
              } else {
                setError(t("onboarding.pin.mismatch"));
                setPin("");
                setFirstPin("");
                setPhase("create");
              }
            }, 200);
          }
        }

        return next;
      });
    },
    [phase, firstPin, saving, router],
  );

  const handleBackspace = useCallback(() => {
    if (saving) return;
    setPin((prev) => prev.slice(0, -1));
    setError(null);
  }, [saving]);

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 items-center justify-between px-6 pt-16 pb-8">
        {/* Header + dots */}
        <View className="items-center flex-1 justify-center">
          <Image
            source={require("../../assets/icon.png")}
            style={{ width: 88, height: 88, marginBottom: 24, borderRadius: 20 }}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
            accessibilityRole="image"
            accessibilityLabel={t("onboarding.logoAccessibility")}
          />

          <Text className="text-foreground text-xl font-semibold mb-2">
            {title}
          </Text>
          <Text className="text-muted-foreground text-sm text-center mb-10">
            {subtitle}
          </Text>

          <PinDots
            length={PIN_LENGTH}
            filled={pin.length}
            error={error !== null}
          />

          {/* Error feedback */}
          <View className="h-12 justify-center mt-4">
            {error ? (
              <Text className="text-red-400 text-sm text-center px-4">
                {error}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Number pad */}
        <View className="w-full pb-4">
          <PinPad
            onDigit={handleDigitPress}
            onBackspace={handleBackspace}
            disabled={saving}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

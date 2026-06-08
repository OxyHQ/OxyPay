/**
 * Lock screen body — Revolut-style PIN entry with optional biometric unlock.
 *
 * Extracted from the old `app/lock.tsx` route so the SAME UI can be rendered as
 * a full-screen overlay (see {@link LockGate}) that covers every authenticated
 * screen while the app is locked (review finding C1). On a correct PIN or
 * biometric match it calls `onUnlock()` instead of navigating, leaving the
 * lock-state transition to the caller.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Pressable, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as LocalAuthentication from "expo-local-authentication";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { verifyPin, isBiometricsEnabled } from "../../storage/secure-store";
import { PinPad } from "./PinPad";
import { PinDots } from "./PinDots";
import { useTheme } from "@oxyhq/bloom/theme";
import { hapticSuccess, hapticError } from "../../utils/haptics";
import { playUnlocked } from "../../services/sounds";
import { APP_NAME } from "@fairco.in/core";
import { t } from "../../i18n";

const PIN_LENGTH = 6;
const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 30;

interface LockScreenContentProps {
  /** Called exactly once when the user successfully unlocks. */
  onUnlock: () => void;
}

export function LockScreenContent({ onUnlock }: LockScreenContentProps) {
  const theme = useTheme();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [lockoutRemaining, setLockoutRemaining] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const lockoutTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isLockedOut = lockedUntil !== null && Date.now() < lockedUntil;

  const handleUnlocked = useCallback(() => {
    hapticSuccess();
    playUnlocked();
    onUnlock();
  }, [onUnlock]);

  const startLockoutTimer = useCallback((until: number) => {
    if (lockoutTimerRef.current) {
      clearInterval(lockoutTimerRef.current);
    }
    const updateRemaining = () => {
      const remaining = Math.ceil((until - Date.now()) / 1000);
      if (remaining <= 0) {
        setLockedUntil(null);
        setLockoutRemaining(0);
        setAttempts(0);
        setError(null);
        if (lockoutTimerRef.current) {
          clearInterval(lockoutTimerRef.current);
          lockoutTimerRef.current = null;
        }
      } else {
        setLockoutRemaining(remaining);
      }
    };
    updateRemaining();
    lockoutTimerRef.current = setInterval(updateRemaining, 1000);
  }, []);

  const tryBiometricAuth = useCallback(async () => {
    try {
      const [hardwareAvailable, enrolled, enabled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
        isBiometricsEnabled(),
      ]);

      if (!hardwareAvailable || !enrolled || !enabled) {
        return;
      }

      setBiometricsAvailable(true);

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: t("lock.unlockPrompt", { app: APP_NAME }),
        disableDeviceFallback: false,
      });

      if (result.success) {
        handleUnlocked();
      }
    } catch (_biometricError: unknown) {
      // Biometric auth failed or unavailable — fall through to PIN entry
    }
  }, [handleUnlocked]);

  // Attempt biometric auth once when the lock screen is shown (the overlay
  // mounts whenever the app becomes locked). A plain effect avoids depending on
  // a navigation/focus context, since this renders as a root overlay, not a
  // routed screen.
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const [hardwareAvailable, enrolled, enabled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
        isBiometricsEnabled(),
      ]).catch(() => [false, false, false] as const);

      if (cancelled) return;

      if (hardwareAvailable && enrolled && enabled) {
        setBiometricsAvailable(true);

        try {
          const result = await LocalAuthentication.authenticateAsync({
            promptMessage: t("lock.unlockPrompt", { app: APP_NAME }),
            disableDeviceFallback: false,
          });

          if (result.success && !cancelled) {
            handleUnlocked();
          }
        } catch (_e: unknown) {
          // Biometric failed — user falls through to PIN
        }
      }
    };

    init();

    return () => {
      cancelled = true;
      if (lockoutTimerRef.current) {
        clearInterval(lockoutTimerRef.current);
        lockoutTimerRef.current = null;
      }
    };
  }, [handleUnlocked]);

  const handleDigitPress = useCallback(
    (digit: string) => {
      if (verifying || isLockedOut) return;

      setError(null);
      setPin((prev) => {
        if (prev.length >= PIN_LENGTH) return prev;
        const next = prev + digit;

        if (next.length === PIN_LENGTH) {
          setVerifying(true);
          verifyPin(next)
            .then((correct) => {
              if (correct) {
                handleUnlocked();
              } else {
                hapticError();
                const newAttempts = attempts + 1;
                setAttempts(newAttempts);

                if (newAttempts >= MAX_ATTEMPTS) {
                  const until = Date.now() + LOCKOUT_SECONDS * 1000;
                  setLockedUntil(until);
                  setError(
                    t("lock.tooManyAttempts", { seconds: LOCKOUT_SECONDS }),
                  );
                  startLockoutTimer(until);
                } else {
                  const remaining = MAX_ATTEMPTS - newAttempts;
                  setError(
                    remaining === 1
                      ? t("lock.wrongPasscode.one", { count: remaining })
                      : t("lock.wrongPasscode.other", { count: remaining }),
                  );
                }
                setPin("");
              }
              setVerifying(false);
            })
            .catch(() => {
              setError(t("lock.verificationFailed"));
              setPin("");
              setVerifying(false);
            });
        }

        return next;
      });
    },
    [verifying, isLockedOut, attempts, handleUnlocked, startLockoutTimer],
  );

  const handleBackspace = useCallback(() => {
    if (verifying || isLockedOut) return;
    setPin((prev) => prev.slice(0, -1));
    setError(null);
  }, [verifying, isLockedOut]);

  const biometricButton = biometricsAvailable ? (
    <Pressable
      className="w-18 h-18 rounded-full items-center justify-center active:bg-primary/10"
      onPress={tryBiometricAuth}
      disabled={isLockedOut}
    >
      <MaterialCommunityIcons
        name="fingerprint"
        size={28}
        color={isLockedOut ? theme.colors.card : theme.colors.primary}
      />
    </Pressable>
  ) : undefined;

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 items-center justify-between px-6 pt-16 pb-8">
        {/* Brand + prompt */}
        <View className="items-center flex-1 justify-center">
          <Image
            source={require("../../../assets/icon.png")}
            style={{ width: 88, height: 88, marginBottom: 24, borderRadius: 20 }}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
            accessibilityRole="image"
            accessibilityLabel={t("onboarding.logoAccessibility")}
          />

          <Text className="text-foreground text-xl font-semibold mb-8">
            {t("lock.enterPasscode")}
          </Text>

          <PinDots
            length={PIN_LENGTH}
            filled={pin.length}
            error={error !== null}
          />

          {/* Error / lockout messages */}
          <View className="h-12 justify-center mt-4">
            {error ? (
              <Text className="text-red-400 text-sm text-center px-4">
                {error}
              </Text>
            ) : null}
            {isLockedOut && lockoutRemaining > 0 ? (
              <Text className="text-muted-foreground text-sm text-center">
                {t("lock.lockedFor", { seconds: lockoutRemaining })}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Number pad */}
        <View className="w-full pb-4">
          <PinPad
            onDigit={handleDigitPress}
            onBackspace={handleBackspace}
            disabled={isLockedOut || verifying}
            biometricButton={biometricButton}
            tintColor={theme.colors.text}
            disabledColor={theme.colors.card}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

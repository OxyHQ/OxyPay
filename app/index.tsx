/**
 * Entry redirect screen.
 * Checks for existing wallet, initializes it from secure store,
 * and routes to the appropriate screen (onboarding, lock, or tabs).
 *
 * This screen renders inside BloomThemeProvider (child of root Stack),
 * so useTheme() is available.
 */

import { useCallback, useState } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { Redirect, useFocusEffect } from "expo-router";
import { useWalletStore } from "../src/wallet/wallet-store";
import { useLockStore } from "../src/wallet/lock-store";
import { getMnemonic, hasPin } from "../src/storage/secure-store";
import { t } from "../src/i18n";

type AppState = "checking" | "onboarding" | "needsPin" | "ready" | "error";

export default function IndexScreen() {
  const [appState, setAppState] = useState<AppState>("checking");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const hasWallet = useWalletStore((s) => s.hasWallet);
  const initialize = useWalletStore((s) => s.initialize);
  const initialized = useWalletStore((s) => s.initialized);
  const resolveInitialLock = useLockStore((s) => s.resolveInitialLock);
  const markNoPinUnlocked = useLockStore((s) => s.markNoPinUnlocked);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const boot = async () => {
        try {
          const exists = await hasWallet();
          if (!exists) {
            // No wallet yet: nothing to lock, go straight to onboarding.
            markNoPinUnlocked();
            if (!cancelled) setAppState("onboarding");
            return;
          }

          const mnemonic = await getMnemonic();
          if (!mnemonic) {
            markNoPinUnlocked();
            if (!cancelled) setAppState("onboarding");
            return;
          }

          // Decide lock state from whether a PIN is set BEFORE exposing keys
          // (review finding C1). If locked, we render the tabs route but the
          // root LockGate overlay covers it and only initializes the wallet
          // after a successful unlock — keys/SPV never come up behind the lock.
          const pinSet = await hasPin();

          // N-7: a persisted wallet WITHOUT a configured PIN is an
          // onboarding-in-progress state. Previously the boot path treated
          // it as "unlocked, ready" — meaning anyone who picks up the device
          // after the user wrote down the mnemonic but before completing
          // pin-setup has full access to funds AND to the recovery phrase
          // (Settings → Recovery). Force-redirect to /onboarding/pin-setup
          // so the configuration completes before any authenticated screen
          // can render.
          if (!pinSet) {
            // Treat this as "no protection yet" for the lock store — the
            // pin-setup screen will mark it unlocked after savePin().
            markNoPinUnlocked();
            if (!cancelled) setAppState("needsPin");
            return;
          }

          const willLock = resolveInitialLock(pinSet);
          if (!willLock && !initialized) {
            await initialize(mnemonic);
          }
          if (!cancelled) setAppState("ready");
        } catch (err: unknown) {
          const msg =
            err instanceof Error ? err.message : t("index.error.load");
          if (!cancelled) {
            setErrorMsg(msg);
            setAppState("error");
          }
        }
      };
      boot();
      return () => {
        cancelled = true;
      };
    }, [
      hasWallet,
      initialize,
      initialized,
      resolveInitialLock,
      markNoPinUnlocked,
    ]),
  );

  if (appState === "onboarding") {
    return <Redirect href="/onboarding/welcome" />;
  }

  if (appState === "needsPin") {
    // N-7: complete pin-setup before any authenticated screen mounts.
    return <Redirect href="/onboarding/pin-setup" />;
  }

  if (appState === "ready") {
    return <Redirect href="/(tabs)" />;
  }

  if (appState === "error") {
    return (
      <View className="flex-1 bg-background items-center justify-center px-6">
        <Text className="text-destructive text-base text-center mb-4">
          {errorMsg}
        </Text>
        <Text className="text-muted-foreground text-sm text-center">
          {t("index.error.help")}
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background items-center justify-center">
      <ActivityIndicator size="large" color="#9ffb50" />
      <Text className="text-muted-foreground text-sm mt-4">
        {t("index.loading")}
      </Text>
    </View>
  );
}

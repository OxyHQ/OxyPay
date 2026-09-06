/**
 * Entry screen — Oxy-first onboarding (spec §4.2).
 *
 * Decides the entry route from Oxy auth state + the on-device identity:
 *   signed out          -> "Sign in with Oxy"
 *   signed in, keyless  -> "Set up your Oxy ID"
 *   signed in, native   -> derive the identity wallet -> PIN gate -> (tabs)
 *   web                 -> your own profile: handle + QR to receive (no key)
 *
 * This screen is the sole authority for the swap; it renders neutral in-place
 * branches and never navigates a child across the boundary.
 */

import { useCallback, useState } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { Redirect, useFocusEffect } from "expo-router";
import { useAuth } from "@oxyhq/services";
import { useWalletStore, type IdentityInitResult } from "../src/wallet/wallet-store";
import { useLockStore } from "../src/wallet/lock-store";
import { hasPin } from "../src/storage/secure-store";
import { decideEntryRoute } from "../src/wallet/entry-route";
import { Button } from "../src/ui/components/Button";
import { CreateOxyIdView } from "../src/ui/components/CreateOxyIdView";
import { t } from "../src/i18n";

export default function IndexScreen() {
  const { isAuthResolved, isAuthenticated, signIn, user } = useAuth();
  const initializeFromIdentity = useWalletStore((s) => s.initializeFromIdentity);
  const initialized = useWalletStore((s) => s.initialized);
  const markNoPinUnlocked = useLockStore((s) => s.markNoPinUnlocked);
  const resolveInitialLock = useLockStore((s) => s.resolveInitialLock);

  const [identityInit, setIdentityInit] = useState<IdentityInitResult | null>(null);
  const [hasPinConfigured, setHasPinConfigured] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const boot = async () => {
        if (!isAuthResolved || !isAuthenticated) return;
        try {
          const pinSet = await hasPin();
          const result: IdentityInitResult = initialized
            ? "initialized"
            : await initializeFromIdentity(() => {});
          if (cancelled) return;
          setHasPinConfigured(pinSet);
          setIdentityInit(result);
          if (result === "initialized") {
            if (!pinSet) markNoPinUnlocked();
            else resolveInitialLock(pinSet);
          } else {
            markNoPinUnlocked();
          }
        } catch (err: unknown) {
          if (!cancelled) {
            setErrorMsg(err instanceof Error ? err.message : t("index.error.load"));
          }
        }
      };
      void boot();
      return () => {
        cancelled = true;
      };
    }, [
      isAuthResolved,
      isAuthenticated,
      initialized,
      initializeFromIdentity,
      markNoPinUnlocked,
      resolveInitialLock,
    ]),
  );

  if (errorMsg) {
    return (
      <View className="flex-1 bg-background items-center justify-center px-6">
        <Text className="text-destructive text-base text-center mb-4">{errorMsg}</Text>
        <Text className="text-muted-foreground text-sm text-center">{t("index.error.help")}</Text>
      </View>
    );
  }

  const route = decideEntryRoute({ isAuthResolved, isAuthenticated, identityInit, hasPinConfigured });

  switch (route.kind) {
    case "ready":
      return <Redirect href="/(tabs)" />;
    case "needs-pin":
      return <Redirect href="/onboarding/pin-setup" />;
    case "signin":
      return (
        <View className="flex-1 bg-background items-center justify-center px-8">
          <Text className="text-foreground text-2xl text-center mb-3">{t("onboarding.signInTitle")}</Text>
          <Text className="text-muted-foreground text-base text-center mb-8">{t("onboarding.signInSubtitle")}</Text>
          <View className="w-full">
            <Button title={t("pay.signIn")} onPress={() => void signIn()} variant="primary" size="lg" />
          </View>
        </View>
      );
    case "create-identity":
      return <CreateOxyIdView />;
    // A browser cannot hold the wallet — the seed derives from an identity key
    // that lives in the platform keystore and never leaves the device. It CAN
    // do the half that needs no private key: your handle, and the QR people
    // scan to pay you. `/@you` already renders exactly that (its `self` branch),
    // so route there rather than dead-ending on "open it on your phone".
    //
    // `username` is always present here: this branch is only reachable once
    // `isAuthenticated` is true. The fallback exists so a malformed session
    // cannot render a blank screen.
    case "web-no-wallet":
      return user?.username ? (
        <Redirect href={`/@${user.username}`} />
      ) : (
        <View className="flex-1 bg-background items-center justify-center px-8">
          <Text className="text-foreground text-2xl text-center mb-3">{t("onboarding.webFallbackTitle")}</Text>
          <Text className="text-muted-foreground text-base text-center">{t("onboarding.webFallbackSubtitle")}</Text>
        </View>
      );
    case "loading":
    default:
      return (
        <View className="flex-1 bg-background items-center justify-center">
          <ActivityIndicator size="large" color="#9ffb50" />
          <Text className="text-muted-foreground text-sm mt-4">{t("index.loading")}</Text>
        </View>
      );
  }
}

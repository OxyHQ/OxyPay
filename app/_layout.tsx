/**
 * Root layout for FAIRWallet.
 *
 * Theme loading strategy (same pattern as Alia):
 * 1. SplashScreen.preventAutoHideAsync() at module level
 * 2. Load persisted theme mode from async storage
 * 3. Mount BloomThemeProvider with correct mode (applies native color scheme
 *    synchronously during render via Bloom 0.1.31)
 * 4. Hide splash screen once ready
 *
 * This ensures no flash of wrong colors on native UI chrome.
 */

import "../src/crypto-polyfill";
import "../global.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, type AppStateStatus, Platform, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { vars } from "nativewind";
import * as Linking from "expo-linking";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { KeyboardProvider as NativeKeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

// react-native-keyboard-controller ships no web build — its KeyboardControllerView
// is a native-only component that breaks the flex height chain on web and leaves
// all scrollables with 0 bounded height. Web has no virtual keyboard anyway, so
// we pass children straight through.
const KeyboardProvider =
  Platform.OS === "web"
    ? ({ children }: { children: React.ReactNode }) => <>{children}</>
    : NativeKeyboardProvider;
import {
  BloomThemeProvider,
  useBloomTheme,
  APP_COLOR_PRESETS,
} from "@oxyhq/bloom/theme";
import type { ThemeMode } from "@oxyhq/bloom/theme";
import { parseFairCoinURI } from "@fairco.in/core";
import { useWalletStore } from "../src/wallet/wallet-store";
import { useLockStore } from "../src/wallet/lock-store";
import { LockGate } from "../src/ui/components/LockGate";
import { getAutoLockTimeout } from "../src/storage/secure-store";
import { initLanguage } from "../src/i18n";
import { useLanguageStore } from "../src/i18n/store";
import { getItemAsync, setItemAsync } from "../src/storage/kv-store";
import { startTxNotifier } from "../src/services/tx-notifier";
import { registerBackgroundSync } from "../src/services/background-sync";

// Module-level initialization. Resolves the persisted or device language,
// then syncs the reactive store so React components see the correct value.
const languageInitPromise = initLanguage()
  .then(() => {
    useLanguageStore.getState().hydrate();
  })
  .catch(() => {
    // Defaults from `initLanguage` remain in place; `hydrate` is still safe.
    useLanguageStore.getState().hydrate();
  });

// Start watching wallet transactions for incoming-payment alerts. Must run
// before any wallet state is hydrated so the subscriber sees every new tx
// beyond the initial snapshot.
startTxNotifier();

// Best-effort background task registration for wake-up payment alerts.
// Safe on platforms that don't support background tasks (web / electron).
void registerBackgroundSync();

// Prevent splash from auto-hiding — we hide it manually after loading
SplashScreen.preventAutoHideAsync().catch(() => {
  // Ignore if activity not available yet (Android dev client reload)
});

const THEME_MODE_KEY = "fairwallet_theme_mode";

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useDeepLinkHandler() {
  const router = useRouter();
  const initialized = useWalletStore((s) => s.initialized);
  const locked = useLockStore((s) => s.locked);

  const handleDeepLink = useCallback(
    (event: { url: string }) => {
      // Never navigate into an authenticated screen while locked or before the
      // wallet is initialized (review finding C1: a deep link must not bypass
      // the lock by pushing straight to /(tabs)/send).
      if (!event.url || !initialized || locked) return;
      const parsed = parseFairCoinURI(event.url);
      if (parsed) {
        router.push({
          pathname: "/(tabs)/send",
          params: { address: parsed.address, amount: parsed.amount ?? "" },
        });
      }
    },
    [router, initialized, locked],
  );

  // Register the URL listener in an effect with proper teardown (review finding
  // M6: the previous ref-in-render registration never removed the listener,
  // leaking a subscription on every remount).
  useEffect(() => {
    const subscription = Linking.addEventListener("url", handleDeepLink);
    let cancelled = false;
    Linking.getInitialURL().then((url) => {
      if (url && !cancelled) handleDeepLink({ url });
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [handleDeepLink]);
}

function useAutoLock() {
  const initialized = useWalletStore((s) => s.initialized);
  const lock = useLockStore((s) => s.lock);
  const backgroundTime = useRef<number | null>(null);

  const handleStateChange = useCallback(
    (state: AppStateStatus) => {
      if (!initialized) return;
      if (state === "background" || state === "inactive") {
        backgroundTime.current = Date.now();
      } else if (state === "active" && backgroundTime.current !== null) {
        const elapsed = Date.now() - backgroundTime.current;
        backgroundTime.current = null;
        getAutoLockTimeout().then((min) => {
          // Re-lock via the lock store so the overlay covers every screen, not
          // just by navigating to a route the user could swipe away from.
          if (elapsed > min * 60_000) lock();
        });
      }
    },
    [initialized, lock],
  );

  // Attach the AppState listener in an effect with teardown (review finding M6).
  useEffect(() => {
    const subscription = AppState.addEventListener("change", handleStateChange);
    return () => {
      subscription.remove();
    };
  }, [handleStateChange]);
}

/**
 * Bridges Bloom preset CSS tokens into NativeWind vars().
 * This makes Tailwind classes (bg-background, text-primary, etc.)
 * resolve to the active Bloom theme colors.
 */
function useThemeVars() {
  const { theme, colorPreset } = useBloomTheme();
  const tokens = theme.isDark
    ? APP_COLOR_PRESETS[colorPreset].dark
    : APP_COLOR_PRESETS[colorPreset].light;

  return useMemo(() => {
    const entries: Record<`--${string}`, string> = {};
    for (const [key, value] of Object.entries(tokens)) {
      entries[key as `--${string}`] = value;
    }
    entries["--success"] = tokens["--primary"] ?? "92 96% 65%";
    entries["--warning"] = "45 93% 47%";
    return vars(entries);
  }, [tokens]);
}

// ---------------------------------------------------------------------------
// Root layout
// ---------------------------------------------------------------------------

export default function RootLayout() {
  useDeepLinkHandler();
  useAutoLock();

  const [fontsLoaded] = useFonts({
    "Phudu-Light": require("../assets/fonts/Phudu-Light.ttf"),
    "Phudu-Regular": require("../assets/fonts/Phudu-Regular.ttf"),
    "Phudu-Bold": require("../assets/fonts/Phudu-Bold.ttf"),
    "Phudu-Black": require("../assets/fonts/Phudu-Black.ttf"),
  });

  const [mode, setMode] = useState<ThemeMode>("dark");
  const [themeReady, setThemeReady] = useState(false);
  const [languageReady, setLanguageReady] = useState(false);
  const language = useLanguageStore((s) => s.language);

  const hydrated = useRef(false);
  if (!hydrated.current) {
    hydrated.current = true;
    getItemAsync(THEME_MODE_KEY).then((stored) => {
      if (stored === "light" || stored === "dark" || stored === "system") {
        setMode(stored);
      }
      setThemeReady(true);
    });
    languageInitPromise.then(() => {
      setLanguageReady(true);
    });
  }

  const handleModeChange = useCallback((next: ThemeMode) => {
    setMode(next);
    setItemAsync(THEME_MODE_KEY, next);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <BloomThemeProvider
            mode={mode}
            colorPreset="faircoin"
            onModeChange={handleModeChange}
          >
            <BottomSheetModalProvider>
              <AppContent
                key={language}
                ready={fontsLoaded && themeReady && languageReady}
              />
            </BottomSheetModalProvider>
          </BloomThemeProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

function AppContent({ ready }: { ready: boolean }) {
  const { theme } = useBloomTheme();
  const themeVars = useThemeVars();

  // Hide splash screen once fonts and theme are loaded
  const splashHidden = useRef(false);
  if (ready && !splashHidden.current) {
    splashHidden.current = true;
    SplashScreen.hideAsync();
  }

  return (
    <View style={[{ flex: 1 }, themeVars]}>
      <StatusBar style={theme.isDark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.background },
          headerTintColor: theme.colors.tint,
          headerTitleStyle: { color: theme.colors.text },
          contentStyle: { backgroundColor: theme.colors.background },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="lock" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="masternode" options={{ headerShown: false, presentation: "modal" }} />
        <Stack.Screen name="wallets" options={{ headerShown: false, presentation: "modal" }} />
        <Stack.Screen name="contacts" options={{ headerShown: false, presentation: "modal" }} />
        <Stack.Screen name="export-key" options={{ headerShown: false, presentation: "modal" }} />
        <Stack.Screen name="coin-control" options={{ headerShown: false, presentation: "modal" }} />
        <Stack.Screen name="peers" options={{ headerShown: false, presentation: "modal" }} />
        <Stack.Screen name="chain" options={{ headerShown: false, presentation: "modal" }} />
        <Stack.Screen name="language" options={{ headerShown: false, presentation: "modal" }} />
        <Stack.Screen name="map" options={{ headerShown: false, presentation: "modal" }} />
        <Stack.Screen name="transaction/[txid]" options={{ headerShown: false }} />
        <Stack.Screen name="buy" options={{ headerShown: false }} />
      </Stack>
      {/* Full-screen lock overlay: covers every authenticated route while the
          app is locked so no screen can be reached behind it (finding C1). */}
      <LockGate />
    </View>
  );
}

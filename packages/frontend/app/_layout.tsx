import 'react-native-url-polyfill/auto';
import 'react-native-reanimated';
import '@/lib/i18n';

import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { BloomThemeProvider } from '@oxyhq/bloom';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';

import { AppProviders } from '@/components/providers/AppProviders';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({});

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  return (
    <BloomThemeProvider fonts>
      <AppProviders>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="receive" options={{ presentation: 'modal', headerShown: true, title: 'Add Cash' }} />
          <Stack.Screen name="cash-out" options={{ presentation: 'modal', headerShown: true, title: 'Cash Out' }} />
          <Stack.Screen name="tap-to-pay" options={{ presentation: 'modal', headerShown: true, title: 'Tap to Pay' }} />
          <Stack.Screen name="+not-found" />
        </Stack>
      </AppProviders>
    </BloomThemeProvider>
  );
}

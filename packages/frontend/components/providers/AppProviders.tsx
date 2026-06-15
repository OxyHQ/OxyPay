import type React from 'react';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { OxyProvider } from '@oxyhq/services';
import { Toaster } from 'sonner-native';
import NetInfo from '@react-native-community/netinfo';
import { onlineManager, queryClient, persister } from '@/lib/queryClient';
import { config } from '@/lib/config';

interface AppProvidersProps {
  children: React.ReactNode;
}

const PERSIST_OPTIONS = {
  persister,
  maxAge: 1000 * 60 * 60 * 24 * 30,
  dehydrateOptions: {
    shouldDehydrateQuery: (query: { queryKey: readonly unknown[] }) => {
      const [namespace] = query.queryKey as string[];
      return namespace === 'oxypay';
    },
  },
};

export function AppProviders({ children }: AppProvidersProps) {
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      onlineManager.setOnline(Boolean(state.isConnected && state.isInternetReachable !== false));
    });
    return unsubscribe;
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PersistQueryClientProvider client={queryClient} persistOptions={PERSIST_OPTIONS}>
        <OxyProvider baseURL={config.oxyApiBaseUrl} clientId={config.oxyClientId}>
          {children}
          <Toaster position="top-center" />
        </OxyProvider>
      </PersistQueryClientProvider>
    </GestureHandlerRootView>
  );
}

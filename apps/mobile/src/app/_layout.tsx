import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '../auth/AppContext';
import { ApiError } from '../lib/api';

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // Don't hammer the API on 4xx (validation, auth); retry network/5xx once.
            retry: (count, err) =>
              count < 1 && !(err instanceof ApiError && (err.status ?? 500) < 500),
          },
        },
      }),
  );
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AppProvider>
          <Stack screenOptions={{ headerShown: false }} />
          <StatusBar style="auto" />
        </AppProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

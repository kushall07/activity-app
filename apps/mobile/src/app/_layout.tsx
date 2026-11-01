import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '../auth/AppContext';
import { ApiError } from '../lib/api';
import { configureNotifications } from '../lib/push';
import { RealtimeProvider } from '../realtime/RealtimeContext';

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
  useEffect(() => configureNotifications(), []);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AppProvider>
          <RealtimeProvider>
            <Stack screenOptions={{ headerShown: false }} />
            <StatusBar style="auto" />
          </RealtimeProvider>
        </AppProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

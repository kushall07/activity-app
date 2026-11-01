import { Platform } from 'react-native';

/**
 * EXPO_PUBLIC_* vars are inlined at build time. For EAS builds set them per
 * profile (development / preview / production) in eas.json or EAS env vars.
 */
function defaultApiUrl(): string {
  // The Android emulator reaches the host machine via 10.0.2.2, not localhost.
  return Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
}

export const config = {
  apiUrl: (process.env.EXPO_PUBLIC_API_URL || defaultApiUrl()).replace(/\/+$/, ''),
  requestTimeoutMs: 8_000,
} as const;

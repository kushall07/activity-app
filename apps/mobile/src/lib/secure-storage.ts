import * as SecureStore from 'expo-secure-store';
import type { TokenStorage } from './session';

const KEY = 'activity.refreshToken';

export const secureTokenStorage: TokenStorage = {
  get: () => SecureStore.getItemAsync(KEY),
  set: (value) =>
    SecureStore.setItemAsync(KEY, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    }),
  clear: () => SecureStore.deleteItemAsync(KEY),
};

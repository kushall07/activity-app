import type { AuthTokens } from '@activity/shared';

export interface TokenStorage {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  clear(): Promise<void>;
}

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

/**
 * Holds the auth tokens. The access token lives only in memory; the refresh token
 * is persisted (iOS Keychain / Android Keystore via expo-secure-store) so the
 * member stays signed in across launches without a new OTP.
 */
export class Session {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private _status: SessionStatus = 'loading';
  private listeners = new Set<(s: SessionStatus) => void>();

  constructor(private readonly storage: TokenStorage) {}

  get status(): SessionStatus {
    return this._status;
  }

  /** Loads the stored refresh token. The first API call then refreshes the access token. */
  async restore(): Promise<void> {
    try {
      this.refreshToken = await this.storage.get();
    } catch {
      this.refreshToken = null;
    }
    this.setStatus(this.refreshToken ? 'signedIn' : 'signedOut');
  }

  async signIn(tokens: AuthTokens): Promise<void> {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
    await this.storage.set(tokens.refreshToken);
    this.setStatus('signedIn');
  }

  async update(tokens: AuthTokens): Promise<void> {
    this.accessToken = tokens.accessToken;
    if (tokens.refreshToken !== this.refreshToken) {
      this.refreshToken = tokens.refreshToken;
      await this.storage.set(tokens.refreshToken);
    }
  }

  async signOut(): Promise<void> {
    this.accessToken = null;
    this.refreshToken = null;
    await this.storage.clear().catch(() => undefined);
    this.setStatus('signedOut');
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  getRefreshToken(): string | null {
    return this.refreshToken;
  }

  subscribe(listener: (s: SessionStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setStatus(status: SessionStatus) {
    this._status = status;
    for (const l of this.listeners) l(status);
  }
}

/** For tests and as a fallback when secure storage is unavailable. */
export function memoryStorage(initial: string | null = null): TokenStorage {
  let value = initial;
  return {
    get: async () => value,
    set: async (v) => {
      value = v;
    },
    clear: async () => {
      value = null;
    },
  };
}

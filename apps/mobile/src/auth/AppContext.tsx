import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createApiClient, type ApiClient } from '../lib/api';
import { config } from '../lib/config';
import { secureTokenStorage } from '../lib/secure-storage';
import { Session, type SessionStatus } from '../lib/session';

interface AppContextValue {
  api: ApiClient;
  session: Session;
  status: SessionStatus;
  signOut: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  children,
  session: injected,
}: {
  children: ReactNode;
  session?: Session;
}) {
  const queryClient = useQueryClient();
  const [session] = useState(() => injected ?? new Session(secureTokenStorage));
  const [api] = useState(() => createApiClient(config.apiUrl, fetch, session));
  const [status, setStatus] = useState<SessionStatus>(session.status);

  useEffect(() => {
    const unsubscribe = session.subscribe((s) => {
      setStatus(s);
      if (s === 'signedOut') queryClient.clear();
    });
    if (session.status === 'loading') void session.restore();
    return unsubscribe;
  }, [session, queryClient]);

  const value = useMemo<AppContextValue>(
    () => ({
      api,
      session,
      status,
      signOut: async () => {
        const token = session.getRefreshToken();
        if (token) await api.logout(token).catch(() => undefined);
        await session.signOut();
      },
    }),
    [api, session, status],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

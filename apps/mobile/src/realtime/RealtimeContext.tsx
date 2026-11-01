import type { Message, ServerFrame } from '@activity/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useApp } from '../auth/AppContext';
import type { ApiClient } from '../lib/api';
import {
  lastStoredId,
  mergeMessages,
  threadKey,
  type ChatMessage,
  type ChatThread,
} from '../lib/chatCache';
import { config } from '../lib/config';
import { RealtimeClient, socketUrl, type RealtimeStatus } from '../lib/realtime';

interface RealtimeValue {
  status: RealtimeStatus;
  /** Sends over the socket when connected, otherwise over REST. Shows it at once as pending. */
  send: (chatId: string, body: string, userId: string) => Promise<void>;
  /** Retries a failed send with the same clientId (the server dedupes). */
  retry: (chatId: string, message: ChatMessage) => Promise<void>;
  markRead: (chatId: string, messageId: number) => void;
}

const RealtimeContext = createContext<RealtimeValue | null>(null);

function addToThread(qc: QueryClient, chatId: string, messages: ChatMessage[]) {
  qc.setQueryData<ChatThread>(threadKey(chatId), (old) =>
    old ? { ...old, messages: mergeMessages(old.messages, messages) } : old,
  );
}

/** After a reconnect: fetch whatever arrived while the socket was down, for each open thread. */
async function catchUp(qc: QueryClient, api: ApiClient) {
  const threads = qc.getQueriesData<ChatThread>({ queryKey: ['thread'] });
  await Promise.all(
    threads.map(async ([key, thread]) => {
      const chatId = key[1] as string;
      if (!thread) return;
      let after = lastStoredId(thread.messages);
      for (let page = 0; page < 5; page++) {
        const res = await api.messages(chatId, { after }).catch(() => null);
        if (!res) return;
        addToThread(qc, chatId, res.messages);
        if (!res.hasMore || res.messages.length === 0) return;
        after = res.messages[res.messages.length - 1]!.id;
      }
      // Far behind: drop the cache and let the screen load the latest page.
      await qc.invalidateQueries({ queryKey: threadKey(chatId) });
    }),
  );
  await qc.invalidateQueries({ queryKey: ['chats'] });
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { api, status: sessionStatus } = useApp();
  const qc = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>('idle');

  const client = useMemo(
    () =>
      new RealtimeClient({
        url: socketUrl(config.apiUrl),
        getToken: (force) => api.accessToken(force),
        onStatus: setStatus,
        onReady: () => void catchUp(qc, api),
        onFrame: (frame: ServerFrame) => {
          if (frame.type === 'message') {
            addToThread(qc, frame.message.chatId, [frame.message]);
            void qc.invalidateQueries({ queryKey: ['chats'] });
          } else if (frame.type === 'chat') {
            void qc.invalidateQueries({ queryKey: ['chats'] });
            void qc.invalidateQueries({ queryKey: ['chat', frame.chatId] });
          }
        },
      }),
    [api, qc],
  );

  useEffect(() => {
    if (sessionStatus !== 'signedIn') {
      client.stop();
      return;
    }
    client.start();
    // Mobile OSes suspend sockets in the background; reconnect as soon as the app is back.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') client.poke();
    });
    return () => {
      sub.remove();
      client.stop();
    };
  }, [client, sessionStatus]);

  const value = useMemo<RealtimeValue>(() => {
    const deliver = async (chatId: string, local: ChatMessage) => {
      addToThread(qc, chatId, [local]);
      try {
        let stored: Message;
        try {
          stored = await client.sendMessage(chatId, local.clientId!, local.body);
        } catch (err) {
          // Socket down or no ack: REST is idempotent on clientId, so this never duplicates.
          if (client.connected && (err as Error).message !== 'No reply from the server') throw err;
          stored = await api.sendMessage(chatId, { clientId: local.clientId!, body: local.body });
        }
        addToThread(qc, chatId, [stored]);
        void qc.invalidateQueries({ queryKey: ['chats'] });
      } catch {
        addToThread(qc, chatId, [{ ...local, pending: false, failed: true }]);
      }
    };
    return {
      status,
      send: (chatId, body, userId) =>
        deliver(chatId, {
          id: -Date.now(),
          chatId,
          senderId: userId,
          kind: 'text',
          body,
          clientId: randomUUID(),
          createdAt: new Date().toISOString(),
          pending: true,
        }),
      retry: (chatId, m) => deliver(chatId, { ...m, pending: true, failed: false }),
      markRead: (chatId, messageId) => {
        if (!client.markRead(chatId, messageId))
          void api.markRead(chatId, messageId).catch(() => undefined);
        void qc.invalidateQueries({ queryKey: ['chats'] });
      },
    };
  }, [api, client, qc, status]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error('useRealtime must be used inside RealtimeProvider');
  return ctx;
}

import type { Message } from '@activity/shared';

/** A message as the app shows it: stored, or still on its way (keyed by clientId). */
export type ChatMessage = Message & { pending?: boolean; failed?: boolean };

/** Cached state for one open chat: oldest first, plus whether older pages exist. */
export interface ChatThread {
  messages: ChatMessage[];
  hasOlder: boolean;
}

export const threadKey = (chatId: string) => ['thread', chatId] as const;

/**
 * Merges messages into a thread: stored messages replace pending copies with
 * the same clientId, duplicates (socket + REST catch-up) collapse by id, and
 * order is by id with pending sends kept at the end.
 */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byKey = new Map<string, ChatMessage>();
  const key = (m: ChatMessage) => (m.pending || m.failed ? `c:${m.clientId}` : `i:${m.id}`);
  for (const m of current) byKey.set(key(m), m);
  for (const m of incoming) {
    if (!m.pending && !m.failed && m.clientId) byKey.delete(`c:${m.clientId}`);
    byKey.set(key(m), m);
  }
  const stored = [...byKey.values()].filter((m) => !m.pending && !m.failed);
  const local = [...byKey.values()].filter((m) => m.pending || m.failed);
  stored.sort((a, b) => a.id - b.id);
  return [...stored, ...local];
}

export function lastStoredId(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (!m.pending && !m.failed) return m.id;
  }
  return 0;
}

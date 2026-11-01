import { CHAT_RULES } from '@activity/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../../auth/AppContext';
import { ErrorText, Loading } from '../../components/ui';
import {
  lastStoredId,
  mergeMessages,
  threadKey,
  type ChatMessage,
  type ChatThread,
} from '../../lib/chatCache';
import { formatWhen } from '../../lib/planFormat';
import { setVisibleChat } from '../../lib/push';
import { useMe } from '../../lib/useMe';
import { useRealtime } from '../../realtime/RealtimeContext';
import { colors } from '../../theme';

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });

function Bubble({
  m,
  mine,
  sender,
  onRetry,
}: {
  m: ChatMessage;
  mine: boolean;
  sender?: string;
  onRetry: () => void;
}) {
  if (m.kind === 'system') return <Text style={styles.system}>{m.body}</Text>;
  return (
    <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
      <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
        {!mine && sender ? <Text style={styles.sender}>{sender}</Text> : null}
        <Text style={[styles.body, mine && styles.bodyMine]}>{m.body}</Text>
        <Text style={[styles.time, mine && styles.timeMine]}>
          {m.pending ? 'Sending…' : m.failed ? 'Not sent' : time(m.createdAt)}
        </Text>
      </View>
      {m.failed ? (
        <Pressable accessibilityRole="button" onPress={onRetry}>
          <Text style={styles.retry}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A plan's group chat: live over the socket, history over REST. */
export default function ChatScreen() {
  const { api } = useApp();
  const qc = useQueryClient();
  const me = useMe();
  const realtime = useRealtime();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [draft, setDraft] = useState('');
  const [loadingOlder, setLoadingOlder] = useState(false);
  const myId = me.data?.user.id;

  const chat = useQuery({ queryKey: ['chat', id], queryFn: () => api.chat(id) });
  const thread = useQuery({
    queryKey: threadKey(id),
    queryFn: async (): Promise<ChatThread> => {
      const res = await api.messages(id);
      return { messages: res.messages, hasOlder: res.hasMore };
    },
    // Live updates arrive over the socket and are merged into this cache.
    staleTime: Infinity,
  });

  useFocusEffect(
    useCallback(() => {
      setVisibleChat(id);
      return () => setVisibleChat(null);
    }, [id]),
  );

  const lastId = thread.data ? lastStoredId(thread.data.messages) : 0;
  useEffect(() => {
    if (lastId > 0) realtime.markRead(id, lastId);
  }, [id, lastId]);

  const loadOlder = async () => {
    const t = thread.data;
    if (!t?.hasOlder || loadingOlder) return;
    const oldest = t.messages.find((m) => !m.pending && !m.failed);
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const res = await api.messages(id, { before: oldest.id });
      qc.setQueryData<ChatThread>(threadKey(id), (old) =>
        old ? { messages: mergeMessages(old.messages, res.messages), hasOlder: res.hasMore } : old,
      );
    } finally {
      setLoadingOlder(false);
    }
  };

  const send = () => {
    const body = draft.trim();
    if (!body || !myId) return;
    setDraft('');
    void realtime.send(id, body, myId);
  };

  if (thread.isPending || chat.isPending) return <Loading />;
  if (chat.error) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.pad}>
          <Text style={styles.titleText}>Chat not available</Text>
          <Text style={styles.muted}>You may have left this plan.</Text>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.link}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const c = chat.data;
  const names = new Map(c.members.map((m) => [m.userId, m.displayName]));
  const others = c.members.filter((m) => m.userId !== myId).map((m) => m.displayName);
  // Inverted list: newest at the bottom, next to the keyboard.
  const data = [...(thread.data?.messages ?? [])].reverse();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open plan details"
          onPress={() => router.push({ pathname: '/plan/[id]', params: { id: c.plan.id } })}
          style={styles.header}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
          >
            <Text style={styles.back}>‹</Text>
          </Pressable>
          <View style={styles.flex}>
            <Text style={styles.titleText} numberOfLines={1}>
              {c.plan.activity.emoji} {c.plan.activity.name}
              {others.length ? ` · ${others.join(', ')}` : ''}
            </Text>
            <Text style={styles.muted} numberOfLines={1}>
              {formatWhen(c.plan.startsAt)} · {c.plan.placeName}, {c.plan.area}
              {realtime.status === 'offline' ? ' · reconnecting…' : ''}
            </Text>
          </View>
        </Pressable>
        {c.plan.status === 'cancelled' ? (
          <Text style={styles.banner}>This plan was cancelled.</Text>
        ) : null}

        <FlatList
          inverted
          data={data}
          keyExtractor={(m) => (m.pending || m.failed ? `c:${m.clientId}` : String(m.id))}
          contentContainerStyle={styles.messages}
          onEndReached={() => void loadOlder()}
          onEndReachedThreshold={0.3}
          renderItem={({ item }) => (
            <Bubble
              m={item}
              mine={item.senderId === myId}
              sender={item.senderId ? names.get(item.senderId) : undefined}
              onRetry={() => void realtime.retry(id, item)}
            />
          )}
          ListEmptyComponent={
            <Text style={styles.system}>Say hi and sort out the details. Keep it in the app.</Text>
          }
        />
        <ErrorText>{thread.error?.message}</ErrorText>
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Message"
            placeholderTextColor="#999"
            accessibilityLabel="Message"
            multiline
            maxLength={CHAT_RULES.messageMaxLength}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            onPress={send}
            disabled={!draft.trim()}
            style={[styles.send, !draft.trim() && { opacity: 0.4 }]}
          >
            <Text style={styles.sendText}>Send</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  pad: { padding: 16, gap: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  back: { fontSize: 32, color: colors.accent, paddingHorizontal: 6 },
  titleText: { fontSize: 17, fontWeight: '700', color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  link: { fontSize: 16, color: colors.accent, fontWeight: '600' },
  banner: {
    backgroundColor: colors.surface,
    color: colors.danger,
    textAlign: 'center',
    padding: 8,
    fontWeight: '600',
  },
  messages: { padding: 12, gap: 6 },
  system: { textAlign: 'center', color: colors.muted, fontSize: 13, marginVertical: 6 },
  bubbleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  mine: { backgroundColor: colors.accent },
  theirs: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  sender: { fontSize: 12, fontWeight: '700', color: colors.accent, marginBottom: 2 },
  body: { fontSize: 16, color: colors.text },
  bodyMine: { color: colors.accentText },
  time: { fontSize: 11, color: colors.muted, marginTop: 2, alignSelf: 'flex-end' },
  timeMine: { color: colors.accentText, opacity: 0.8 },
  retry: { color: colors.danger, fontWeight: '600' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.background,
  },
  send: {
    backgroundColor: colors.accent,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendText: { color: colors.accentText, fontWeight: '700' },
});

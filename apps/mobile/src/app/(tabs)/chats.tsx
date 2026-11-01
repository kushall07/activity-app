import type { ChatSummary } from '@activity/shared';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../../auth/AppContext';
import { ErrorText } from '../../components/ui';
import { formatWhen } from '../../lib/planFormat';
import { useMe } from '../../lib/useMe';
import { colors } from '../../theme';

function ChatRow({ chat, myId }: { chat: ChatSummary; myId?: string }) {
  const others = chat.members.filter((m) => m.userId !== myId);
  const names = others.map((m) => m.displayName).join(', ') || 'Just you so far';
  const last = chat.lastMessage;
  const photo = others[0]?.photoUrl;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${chat.plan.activity.name} with ${names}${chat.unread ? `, ${chat.unread} unread` : ''}`}
      onPress={() => router.push({ pathname: '/chat/[id]', params: { id: chat.id } })}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
    >
      {photo ? (
        <Image source={{ uri: photo }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.emojiAvatar]}>
          <Text style={styles.emoji}>{chat.plan.activity.emoji}</Text>
        </View>
      )}
      <View style={styles.flex}>
        <Text style={styles.title} numberOfLines={1}>
          {chat.plan.activity.emoji} {chat.plan.activity.name} · {names}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {last ? last.body : formatWhen(chat.plan.startsAt)}
        </Text>
      </View>
      {chat.unread ? (
        <Text style={styles.unread}>{chat.unread > 99 ? '99+' : chat.unread}</Text>
      ) : null}
    </Pressable>
  );
}

/** One chat per plan, newest activity first. Chats open once a host accepts someone. */
export default function ChatsScreen() {
  const { api } = useApp();
  const me = useMe();
  const chats = useQuery({ queryKey: ['chats'], queryFn: () => api.chats() });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        data={chats.data?.chats ?? []}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.gap} />}
        renderItem={({ item }) => <ChatRow chat={item} myId={me.data?.user.id} />}
        refreshControl={
          <RefreshControl refreshing={chats.isRefetching} onRefresh={() => void chats.refetch()} />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.heading} accessibilityRole="header">
              Chats
            </Text>
            <ErrorText>{chats.error?.message}</ErrorText>
          </View>
        }
        ListEmptyComponent={
          chats.isPending ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Text style={styles.sub}>
              When a host accepts you, or you accept someone, your plan's chat appears here.
            </Text>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: 16, paddingBottom: 32 },
  header: { gap: 8, marginBottom: 12 },
  heading: { fontSize: 28, fontWeight: '700', color: colors.text },
  gap: { height: 10 },
  flex: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.border },
  emojiAvatar: { alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 24 },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  sub: { fontSize: 14, color: colors.muted },
  unread: {
    minWidth: 24,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.accent,
    color: colors.accentText,
    fontWeight: '700',
    textAlign: 'center',
  },
});

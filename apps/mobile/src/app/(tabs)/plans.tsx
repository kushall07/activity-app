import type { MyRequest } from '@activity/shared';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
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
import { PlanCard } from '../../components/PlanCard';
import { Button, Chips, ErrorText } from '../../components/ui';
import { formatWhen, REQUEST_LABEL } from '../../lib/planFormat';
import { colors } from '../../theme';

type Scope = 'upcoming' | 'joined' | 'past';
const SCOPES = [
  { value: 'upcoming', label: 'Hosting' },
  { value: 'joined', label: 'Joined & requests' },
  { value: 'past', label: 'Past' },
] as const;

function RequestRow({ r }: { r: MyRequest }) {
  const open = () =>
    r.chatId
      ? router.push({ pathname: '/chat/[id]', params: { id: r.chatId } })
      : router.push({ pathname: '/plan/[id]', params: { id: r.plan.id } });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${r.plan.activity.name} with ${r.plan.hostName}: ${REQUEST_LABEL[r.status]}`}
      onPress={open}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
    >
      <Text style={styles.rowEmoji}>{r.plan.activity.emoji}</Text>
      <View style={styles.flex}>
        <Text style={styles.rowTitle}>
          {r.plan.activity.name} with {r.plan.hostName}
        </Text>
        <Text style={styles.sub}>
          {formatWhen(r.plan.startsAt)} · {r.plan.area}
        </Text>
      </View>
      {r.plan.hostPhotoUrl ? (
        <Image source={{ uri: r.plan.hostPhotoUrl }} style={styles.avatar} />
      ) : null}
      <Text style={[styles.status, r.status === 'accepted' && styles.statusIn]}>
        {REQUEST_LABEL[r.status]}
      </Text>
    </Pressable>
  );
}

/** Plans the member hosts, and the ones they asked to join. */
export default function MyPlansScreen() {
  const { api } = useApp();
  const [scope, setScope] = useState<Scope>('upcoming');
  const hosting = useQuery({
    queryKey: ['myPlans', scope],
    queryFn: () => api.myPlans(scope === 'past' ? 'past' : 'upcoming'),
    enabled: scope !== 'joined',
  });
  const requests = useQuery({
    queryKey: ['myRequests'],
    queryFn: () => api.myRequests(),
    enabled: scope === 'joined',
  });
  const active = scope === 'joined' ? requests : hosting;

  const header = (
    <View style={styles.header}>
      <Text style={styles.title} accessibilityRole="header">
        My plans
      </Text>
      <Chips label="Show" options={SCOPES} value={scope} onChange={setScope} />
      <ErrorText>{active.error?.message}</ErrorText>
    </View>
  );
  const empty = active.isPending ? (
    <ActivityIndicator color={colors.accent} />
  ) : active.isError ? undefined : (
    <View style={styles.empty}>
      <Text style={styles.sub}>
        {scope === 'upcoming'
          ? 'You are not hosting anything yet.'
          : scope === 'joined'
            ? 'Tap “I’m in” on a plan in Explore and it shows up here.'
            : 'Nothing here yet.'}
      </Text>
      {scope === 'upcoming' ? (
        <Button label="Post a plan" onPress={() => router.push('/post')} />
      ) : null}
      {scope === 'joined' ? (
        <Button label="Explore plans" onPress={() => router.push('/explore')} />
      ) : null}
    </View>
  );
  const refresh = (
    <RefreshControl refreshing={active.isRefetching} onRefresh={() => void active.refetch()} />
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {scope === 'joined' ? (
        <FlatList
          data={requests.data?.requests ?? []}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.gap} />}
          renderItem={({ item }) => <RequestRow r={item} />}
          refreshControl={refresh}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
        />
      ) : (
        <FlatList
          data={hosting.data?.plans ?? []}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.gap} />}
          renderItem={({ item }) => (
            <PlanCard
              plan={item}
              onPress={() => router.push({ pathname: '/plan/[id]', params: { id: item.id } })}
            />
          )}
          refreshControl={refresh}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: 16, paddingBottom: 32 },
  header: { gap: 12, marginBottom: 12 },
  title: { fontSize: 28, fontWeight: '700', color: colors.text },
  sub: { fontSize: 14, color: colors.muted },
  gap: { height: 12 },
  empty: { gap: 12, paddingVertical: 24 },
  flex: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  rowEmoji: { fontSize: 28 },
  rowTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.border },
  status: { fontSize: 13, fontWeight: '600', color: colors.muted },
  statusIn: { color: colors.success },
});

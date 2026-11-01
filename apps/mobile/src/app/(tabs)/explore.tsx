import type { ActivityCategory } from '@activity/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../../auth/AppContext';
import { PlanCard } from '../../components/PlanCard';
import { Button, ErrorText, Loading } from '../../components/ui';
import type { FeedParams } from '../../lib/api';
import { useFeedOrigin } from '../../lib/location';
import { whenRange, type When } from '../../lib/planFormat';
import { useMe } from '../../lib/useMe';
import { colors } from '../../theme';

const CATEGORIES: { value: ActivityCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'sport', label: '🏸 Sport' },
  { value: 'show', label: '🎤 Shows' },
  { value: 'workshop', label: '🏺 Workshops' },
  { value: 'food', label: '🍽️ Food' },
  { value: 'games', label: '🎲 Games' },
  { value: 'outdoors', label: '🥾 Outdoors' },
  { value: 'art', label: '🎨 Art' },
  { value: 'science', label: '🔭 Science' },
];

const WHEN: { value: When; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'weekend', label: 'This weekend' },
];
const DISTANCES = [2, 5, 10, 25];
const SORTS = [
  { value: 'soonest', label: 'Soonest first' },
  { value: 'nearest', label: 'Nearest first' },
] as const;
function ChipRow<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            style={[styles.chip, selected && styles.chipSelected]}
          >
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Home tab: plans near the member that they can join. */
export default function ExploreScreen() {
  const { api } = useApp();
  const me = useMe();
  const origin = useFeedOrigin(me.data ? (me.data.profile?.neighbourhood ?? null) : undefined);
  const [category, setCategory] = useState<ActivityCategory | 'all'>('all');
  const [when, setWhen] = useState<When>('any');
  const [radiusKm, setRadiusKm] = useState<number>(10);
  const [sort, setSort] = useState<'soonest' | 'nearest'>('soonest');

  const params = useMemo<FeedParams | null>(
    () =>
      origin && {
        lat: origin.lat,
        lng: origin.lng,
        radiusKm,
        sort,
        categories: category === 'all' ? undefined : [category],
        ...whenRange(when),
      },
    [origin, radiusKm, sort, category, when],
  );

  const feed = useInfiniteQuery({
    queryKey: ['feed', params],
    enabled: !!params,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.feed({ ...params!, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const plans = feed.data?.pages.flatMap((p) => p.plans) ?? [];

  if (!origin) return <Loading />;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        data={plans}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <PlanCard
            plan={item}
            onPress={() =>
              router.push({
                pathname: '/plan/[id]',
                params: { id: item.id, lat: String(origin.lat), lng: String(origin.lng) },
              })
            }
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.gap} />}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
        }}
        refreshControl={
          <RefreshControl
            refreshing={feed.isRefetching && !feed.isFetchingNextPage}
            onRefresh={() => void feed.refetch()}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">
              Explore
            </Text>
            <Text style={styles.sub}>
              {origin.label} · within {radiusKm} km
            </Text>
            <ChipRow options={CATEGORIES} value={category} onChange={setCategory} />
            <ChipRow options={WHEN} value={when} onChange={setWhen} />
            <ChipRow
              options={DISTANCES.map((d) => ({ value: d, label: `${d} km` }))}
              value={radiusKm}
              onChange={setRadiusKm}
            />
            <ChipRow options={SORTS} value={sort} onChange={setSort} />
            <ErrorText>{feed.error?.message}</ErrorText>
          </View>
        }
        ListEmptyComponent={
          feed.isPending ? (
            <ActivityIndicator color={colors.accent} style={styles.gap} />
          ) : feed.isError ? undefined : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No plans here yet</Text>
              <Text style={styles.sub}>
                Try a wider distance or another day, or post the first plan yourself.
              </Text>
              <Button label="Post a plan" onPress={() => router.push('/post')} />
            </View>
          )
        }
        ListFooterComponent={
          feed.isFetchingNextPage ? <ActivityIndicator color={colors.accent} /> : undefined
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: 16, paddingBottom: 32 },
  header: { gap: 10, marginBottom: 12 },
  title: { fontSize: 28, fontWeight: '700', color: colors.text },
  sub: { fontSize: 15, color: colors.muted, lineHeight: 21 },
  gap: { height: 12 },
  chipRow: { gap: 8, paddingRight: 16 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { color: colors.text, fontSize: 14 },
  chipTextSelected: { color: colors.surface, fontWeight: '600' },
  empty: { gap: 12, paddingVertical: 32 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
});

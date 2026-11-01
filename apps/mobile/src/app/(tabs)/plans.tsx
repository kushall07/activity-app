import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../../auth/AppContext';
import { PlanCard } from '../../components/PlanCard';
import { Button, Chips, ErrorText } from '../../components/ui';
import { colors } from '../../theme';

const SCOPES = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past and cancelled' },
] as const;

/** Plans the member is hosting. Plans they joined arrive with requests (milestone 4). */
export default function MyPlansScreen() {
  const { api } = useApp();
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const plans = useQuery({ queryKey: ['myPlans', scope], queryFn: () => api.myPlans(scope) });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        data={plans.data?.plans ?? []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.gap} />}
        renderItem={({ item }) => (
          <PlanCard
            plan={item}
            onPress={() => router.push({ pathname: '/plan/[id]', params: { id: item.id } })}
          />
        )}
        refreshControl={
          <RefreshControl refreshing={plans.isRefetching} onRefresh={() => void plans.refetch()} />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">
              My plans
            </Text>
            <Chips label="Show" options={SCOPES} value={scope} onChange={setScope} />
            <ErrorText>{plans.error?.message}</ErrorText>
          </View>
        }
        ListEmptyComponent={
          plans.isPending ? (
            <ActivityIndicator color={colors.accent} />
          ) : plans.isError ? undefined : (
            <View style={styles.empty}>
              <Text style={styles.sub}>
                {scope === 'upcoming' ? 'You are not hosting anything yet.' : 'Nothing here yet.'}
              </Text>
              {scope === 'upcoming' ? (
                <Button label="Post a plan" onPress={() => router.push('/post')} />
              ) : null}
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: 16, paddingBottom: 32 },
  header: { gap: 12, marginBottom: 12 },
  title: { fontSize: 28, fontWeight: '700', color: colors.text },
  sub: { fontSize: 15, color: colors.muted },
  gap: { height: 12 },
  empty: { gap: 12, paddingVertical: 24 },
});

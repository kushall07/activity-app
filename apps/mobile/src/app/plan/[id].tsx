import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Image, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../../auth/AppContext';
import { JoinPanel } from '../../components/JoinPanel';
import { Button, ErrorText, Loading, Screen } from '../../components/ui';
import {
  formatCost,
  formatDistance,
  formatDuration,
  formatSeats,
  formatWhen,
  formatWho,
  INTENT_LABEL,
  SKILL_LABEL,
} from '../../lib/planFormat';
import { colors } from '../../theme';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

/** Plan details: the plan, the host, "I'm in" for members, and requests, edit and cancel for the host. */
export default function PlanScreen() {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string; lat?: string; lng?: string }>();
  const origin =
    params.lat && params.lng ? { lat: Number(params.lat), lng: Number(params.lng) } : undefined;

  const plan = useQuery({
    queryKey: ['plan', params.id],
    queryFn: () => api.plan(params.id, origin),
  });

  const cancel = useMutation({
    mutationFn: () => api.cancelPlan(params.id),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['plan', params.id], updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['myPlans'] }),
        queryClient.invalidateQueries({ queryKey: ['feed'] }),
      ]);
    },
  });

  if (plan.isPending) return <Loading />;
  if (plan.error) {
    return (
      <Screen>
        <Text style={styles.title}>Plan not available</Text>
        <Text style={styles.muted}>
          {plan.error.message === 'Plan not found'
            ? 'It may have been cancelled, or it is not open to you.'
            : plan.error.message}
        </Text>
        <Button label="Back" variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  }

  const p = plan.data;
  const open = p.status === 'open' || p.status === 'full';
  const distance = formatDistance(p.distanceKm);
  const confirmCancel = () =>
    Alert.alert('Cancel this plan?', 'It disappears from Explore. This cannot be undone.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel plan', style: 'destructive', onPress: () => cancel.mutate() },
    ]);

  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={styles.emoji}>{p.activity.emoji}</Text>
        <Text style={styles.title} accessibilityRole="header">
          {p.activity.name}
        </Text>
        <Text style={styles.when}>{formatWhen(p.startsAt)}</Text>
        {!open ? (
          <Text style={styles.status}>
            {p.status === 'cancelled' ? 'Cancelled' : 'This plan has ended'}
          </Text>
        ) : null}
      </View>

      <View style={styles.card}>
        <Row
          label="Where"
          value={`${p.place.name}, ${p.place.area}${distance ? ` (${distance})` : ''}`}
        />
        <Row label="How long" value={formatDuration(p.durationMinutes)} />
        <Row label="Looking for" value={`${formatWho(p)}, ${p.ageMin}–${p.ageMax}`} />
        <Row label="Seats" value={formatSeats(p)} />
        <Row label="Level" value={SKILL_LABEL[p.skillLevel]} />
        <Row label="Vibe" value={INTENT_LABEL[p.intent]} />
        <Row label="Cost" value={formatCost(p)} />
        {p.verifiedOnly ? <Row label="Who can join" value="Verified members only" /> : null}
      </View>

      {p.note ? <Text style={styles.note}>“{p.note}”</Text> : null}

      <View style={styles.host}>
        {p.host.photoUrl ? (
          <Image
            source={{ uri: p.host.photoUrl }}
            style={styles.avatar}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={styles.avatar} />
        )}
        <View>
          <Text style={styles.hostName}>
            {p.isMine ? 'You are hosting' : `Hosted by ${p.host.displayName}, ${p.host.age}`}
          </Text>
          {p.host.verified ? <Text style={styles.verified}>✓ Photo verified</Text> : null}
        </View>
      </View>

      {p.isMine && open ? (
        <>
          <Button
            label={
              p.pendingRequests
                ? `See requests (${p.pendingRequests})`
                : p.seats.taken
                  ? 'Who is going'
                  : 'Requests'
            }
            onPress={() =>
              router.push({ pathname: '/requests/[planId]', params: { planId: p.id } })
            }
          />
          {p.chatId ? (
            <Button
              label="Open chat"
              variant="secondary"
              onPress={() => router.push({ pathname: '/chat/[id]', params: { id: p.chatId! } })}
            />
          ) : null}
          <Button
            label="Edit plan"
            variant="secondary"
            onPress={() => router.push({ pathname: '/post', params: { edit: p.id } })}
          />
          <ErrorText>{cancel.error?.message}</ErrorText>
          <Button
            label="Cancel plan"
            variant="danger"
            onPress={confirmCancel}
            loading={cancel.isPending}
          />
        </>
      ) : null}
      {!p.isMine && open ? <JoinPanel plan={p} /> : null}
      <Button label="Back" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 4, paddingVertical: 8 },
  emoji: { fontSize: 56 },
  title: { fontSize: 28, fontWeight: '700', color: colors.text },
  when: { fontSize: 17, color: colors.accent, fontWeight: '600' },
  status: { fontSize: 15, color: colors.danger, fontWeight: '600' },
  muted: { fontSize: 15, color: colors.muted, lineHeight: 21 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 10,
  },
  row: { flexDirection: 'row', gap: 12 },
  rowLabel: { width: 96, fontSize: 14, color: colors.muted },
  rowValue: { flex: 1, fontSize: 15, color: colors.text },
  note: { fontSize: 16, fontStyle: 'italic', color: colors.text, lineHeight: 23 },
  host: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.border },
  hostName: { fontSize: 16, fontWeight: '600', color: colors.text },
  verified: { fontSize: 14, color: colors.success, fontWeight: '600' },
});

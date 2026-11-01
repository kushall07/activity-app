import type { PlanRequest } from '@activity/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../../auth/AppContext';
import { Button, ErrorText, Loading, Screen } from '../../components/ui';
import { SKILL_LABEL } from '../../lib/planFormat';
import { colors } from '../../theme';

function RequestCard({
  r,
  onAccept,
  onDecline,
  busy,
}: {
  r: PlanRequest;
  onAccept: () => void;
  onDecline: () => void;
  busy: boolean;
}) {
  const p = r.requester;
  return (
    <View style={styles.card}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.photos}
      >
        {p.photoUrls.map((uri) => (
          <Image key={uri} source={{ uri }} style={styles.photo} accessibilityIgnoresInvertColors />
        ))}
      </ScrollView>
      <Text style={styles.name}>
        {p.displayName}, {p.age} {p.verified ? <Text style={styles.verified}>✓</Text> : null}
      </Text>
      <Text style={styles.meta}>
        {[p.neighbourhood, p.jobTitle, r.skillLevel ? SKILL_LABEL[r.skillLevel] : null]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      {r.reasons.length ? (
        <View style={styles.reasons}>
          {r.reasons.map((reason) => (
            <Text key={reason} style={styles.reason}>
              {reason}
            </Text>
          ))}
        </View>
      ) : null}
      {r.message ? <Text style={styles.message}>“{r.message}”</Text> : null}
      {p.bio ? <Text style={styles.bio}>{p.bio}</Text> : null}
      {p.interests.length ? <Text style={styles.meta}>Into {p.interests.join(', ')}</Text> : null}
      <View style={styles.actions}>
        <View style={styles.flex}>
          <Button label="Not this time" variant="secondary" onPress={onDecline} disabled={busy} />
        </View>
        <View style={styles.flex}>
          <Button label="Accept" onPress={onAccept} loading={busy} />
        </View>
      </View>
    </View>
  );
}

/** The host's request stack: best match first, with the reasons; and who is already in. */
export default function RequestsScreen() {
  const { api } = useApp();
  const qc = useQueryClient();
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const stack = useQuery({
    queryKey: ['planRequests', planId],
    queryFn: () => api.planRequests(planId),
  });
  const plan = useQuery({ queryKey: ['plan', planId], queryFn: () => api.plan(planId) });

  const decide = useMutation({
    mutationFn: (v: { id: string; action: 'accept' | 'decline' }) =>
      api.decideRequest(v.id, v.action),
    onSuccess: async (res) => {
      if (res.plan) qc.setQueryData(['plan', planId], res.plan);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['planRequests', planId] }),
        qc.invalidateQueries({ queryKey: ['myPlans'] }),
        qc.invalidateQueries({ queryKey: ['chats'] }),
      ]);
    },
    // Someone else may have taken the last seat; show the fresh stack.
    onError: () => void qc.invalidateQueries({ queryKey: ['planRequests', planId] }),
  });

  if (stack.isPending) return <Loading />;
  const p = plan.data;
  const pending = stack.data?.pending ?? [];
  const accepted = stack.data?.accepted ?? [];

  return (
    <Screen>
      <Text style={styles.title} accessibilityRole="header">
        {p ? `${p.activity.emoji} ${p.activity.name}` : 'Requests'}
      </Text>
      {p ? (
        <Text style={styles.meta}>
          {p.seats.taken} of {p.seats.total} seats taken
          {p.seats.open === 0 ? ' · full' : ''}
        </Text>
      ) : null}
      <ErrorText>{stack.error?.message ?? decide.error?.message}</ErrorText>

      {accepted.length ? (
        <View style={styles.section}>
          <Text style={styles.heading}>Going</Text>
          {accepted.map((r) => (
            <View key={r.id} style={styles.going}>
              {r.requester.photoUrls[0] ? (
                <Image source={{ uri: r.requester.photoUrls[0] }} style={styles.avatar} />
              ) : null}
              <Text style={styles.goingName}>
                {r.requester.displayName}, {r.requester.age}
              </Text>
            </View>
          ))}
          {p?.chatId ? (
            <Button
              label="Open chat"
              variant="secondary"
              onPress={() => router.push({ pathname: '/chat/[id]', params: { id: p.chatId! } })}
            />
          ) : null}
        </View>
      ) : null}

      <Text style={styles.heading}>Waiting ({pending.length})</Text>
      {pending.length === 0 ? (
        <Text style={styles.meta}>
          No one is waiting right now. We'll notify you when someone asks.
        </Text>
      ) : (
        pending.map((r) => (
          <RequestCard
            key={r.id}
            r={r}
            busy={decide.isPending && decide.variables?.id === r.id}
            onAccept={() => decide.mutate({ id: r.id, action: 'accept' })}
            onDecline={() => decide.mutate({ id: r.id, action: 'decline' })}
          />
        ))
      )}
      <Button label="Back" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 26, fontWeight: '700', color: colors.text },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 8 },
  section: { gap: 8 },
  meta: { fontSize: 14, color: colors.muted },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
  },
  photos: { gap: 8 },
  photo: { width: 150, height: 200, borderRadius: 12, backgroundColor: colors.border },
  name: { fontSize: 20, fontWeight: '700', color: colors.text },
  verified: { color: colors.success },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reason: {
    fontSize: 13,
    color: colors.accent,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  message: { fontSize: 16, fontStyle: 'italic', color: colors.text },
  bio: { fontSize: 15, color: colors.text, lineHeight: 21 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  flex: { flex: 1 },
  going: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.border },
  goingName: { fontSize: 16, color: colors.text },
});

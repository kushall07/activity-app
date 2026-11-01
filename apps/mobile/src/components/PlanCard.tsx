import type { Plan } from '@activity/shared';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  formatCost,
  formatDistance,
  formatSeats,
  formatWhen,
  formatWho,
  INTENT_LABEL,
  REQUEST_LABEL,
} from '../lib/planFormat';
import { colors } from '../theme';

/** A plan in a list: what, when, where, who's hosting and who they are looking for. */
export function PlanCard({ plan, onPress }: { plan: Plan; onPress?: () => void }) {
  const distance = formatDistance(plan.distanceKm);
  const closed = plan.status === 'cancelled' || plan.status === 'completed';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${plan.activity.name}, ${formatWhen(plan.startsAt)}, ${plan.place.name}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed, closed && styles.closed]}
    >
      <View style={styles.top}>
        <Text style={styles.emoji}>{plan.activity.emoji}</Text>
        <View style={styles.flex}>
          <Text style={styles.activity}>{plan.activity.name}</Text>
          <Text style={styles.when}>{formatWhen(plan.startsAt)}</Text>
        </View>
        <Text style={[styles.badge, plan.seats.open === 0 && styles.badgeFull]}>
          {closed ? (plan.status === 'cancelled' ? 'Cancelled' : 'Done') : formatSeats(plan)}
        </Text>
      </View>

      <Text style={styles.place} numberOfLines={1}>
        📍 {plan.place.name} · {plan.place.area}
        {distance ? ` · ${distance}` : ''}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        Looking for {formatWho(plan)} · {INTENT_LABEL[plan.intent]}
      </Text>
      <Text style={styles.meta}>{formatCost(plan)}</Text>

      <View style={styles.host}>
        {plan.host.photoUrl ? (
          <Image
            source={{ uri: plan.host.photoUrl }}
            style={styles.avatar}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={[styles.avatar, styles.avatarEmpty]} />
        )}
        <Text style={styles.hostName}>
          {plan.isMine ? 'Your plan' : `${plan.host.displayName}, ${plan.host.age}`}
        </Text>
        {plan.host.verified && !plan.isMine ? (
          <Text style={styles.verified}>✓ Verified</Text>
        ) : null}
        {plan.verifiedOnly ? <Text style={styles.tag}>Verified only</Text> : null}
      </View>
      {plan.pendingRequests ? (
        <Text style={styles.requests}>
          🙋 {plan.pendingRequests} {plan.pendingRequests === 1 ? 'person wants' : 'people want'} to
          join
        </Text>
      ) : null}
      {plan.myRequest ? (
        <Text style={styles.requests}>{REQUEST_LABEL[plan.myRequest.status]}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.85 },
  requests: { fontSize: 14, fontWeight: '600', color: colors.accent, marginTop: 4 },
  closed: { opacity: 0.6 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  flex: { flex: 1 },
  emoji: { fontSize: 34 },
  activity: { fontSize: 18, fontWeight: '700', color: colors.text },
  when: { fontSize: 15, color: colors.accent, fontWeight: '600' },
  badge: {
    backgroundColor: colors.background,
    color: colors.text,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: 'hidden',
    fontSize: 13,
    fontWeight: '600',
  },
  badgeFull: { color: colors.muted },
  place: { fontSize: 15, color: colors.text },
  meta: { fontSize: 14, color: colors.muted },
  host: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.border },
  avatarEmpty: {},
  hostName: { fontSize: 14, fontWeight: '600', color: colors.text },
  verified: { fontSize: 13, color: colors.success, fontWeight: '600' },
  tag: {
    fontSize: 12,
    color: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
});

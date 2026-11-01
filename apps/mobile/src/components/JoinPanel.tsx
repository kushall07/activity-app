import { REQUEST_RULES, type Plan, type SkillLevel } from '@activity/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../auth/AppContext';
import { REQUEST_LABEL, SKILL_LABEL } from '../lib/planFormat';
import { colors } from '../theme';
import { Button, Chips, ErrorText, Field } from './ui';

const LEVELS = (['beginner', 'intermediate', 'advanced'] as const).map((value) => ({
  value,
  label: SKILL_LABEL[value],
}));

/**
 * "I'm in" for someone else's plan: ask to join (with an optional note and
 * level), see where the request stands, open the chat once accepted, or back out.
 */
export function JoinPanel({ plan }: { plan: Plan }) {
  const { api } = useApp();
  const qc = useQueryClient();
  const [composing, setComposing] = useState(false);
  const [message, setMessage] = useState('');
  const [level, setLevel] = useState<Exclude<SkillLevel, 'any'> | null>(null);

  const refresh = async (updated: Plan | null) => {
    if (updated) qc.setQueryData(['plan', plan.id], updated);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['feed'] }),
      qc.invalidateQueries({ queryKey: ['myRequests'] }),
      qc.invalidateQueries({ queryKey: ['chats'] }),
    ]);
  };

  const join = useMutation({
    mutationFn: () =>
      api.requestToJoin(plan.id, { message: message.trim(), skillLevel: level ?? undefined }),
    onSuccess: async (res) => {
      setComposing(false);
      await refresh(res.plan);
    },
  });
  const withdraw = useMutation({
    mutationFn: (requestId: string) => api.decideRequest(requestId, 'withdraw'),
    onSuccess: async (res) => {
      await refresh(res.plan);
      if (!res.plan) router.back();
    },
  });

  const r = plan.myRequest;
  if (r?.status === 'accepted') {
    return (
      <View style={styles.box}>
        <Text style={styles.in}>🎉 You're in!</Text>
        {plan.chatId ? (
          <Button
            label="Open chat"
            onPress={() => router.push({ pathname: '/chat/[id]', params: { id: plan.chatId! } })}
          />
        ) : null}
        <ErrorText>{withdraw.error?.message}</ErrorText>
        <Button
          label="Leave plan"
          variant="danger"
          loading={withdraw.isPending}
          onPress={() =>
            Alert.alert(
              'Leave this plan?',
              'Your seat goes back to the host and you leave the chat.',
              [
                { text: 'Stay', style: 'cancel' },
                { text: 'Leave', style: 'destructive', onPress: () => withdraw.mutate(r.id) },
              ],
            )
          }
        />
      </View>
    );
  }
  if (r) {
    return (
      <View style={styles.box}>
        <Text style={styles.status}>{REQUEST_LABEL[r.status]}</Text>
        <Text style={styles.muted}>
          {r.status === 'pending'
            ? `${plan.host.displayName} will see your profile and decide. You'll get a notification.`
            : r.status === 'declined'
              ? 'The host went with someone else this time. Plenty more plans in Explore.'
              : r.status === 'expired'
                ? 'The host did not answer in time.'
                : null}
        </Text>
        <ErrorText>{withdraw.error?.message}</ErrorText>
        {r.status === 'pending' ? (
          <Button
            label="Withdraw request"
            variant="secondary"
            loading={withdraw.isPending}
            onPress={() => withdraw.mutate(r.id)}
          />
        ) : null}
      </View>
    );
  }
  if (plan.seats.open === 0) {
    return <Text style={styles.muted}>This plan is full.</Text>;
  }
  if (!composing) {
    return <Button label="I'm in" onPress={() => setComposing(true)} />;
  }
  return (
    <View style={styles.box}>
      {plan.skillLevel !== 'any' ? (
        <Chips label="Your level" options={LEVELS} value={level} onChange={setLevel} />
      ) : null}
      <Field
        label="Say something (optional)"
        value={message}
        onChangeText={setMessage}
        maxLength={REQUEST_RULES.messageMaxLength}
        multiline
        placeholder="I play most weekends, happy to bring a racket"
      />
      <ErrorText>{join.error?.message}</ErrorText>
      <Button
        label={plan.autoAccept ? 'Join' : 'Send request'}
        loading={join.isPending}
        onPress={() => join.mutate()}
      />
      <Button label="Not now" variant="secondary" onPress={() => setComposing(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 10 },
  in: { fontSize: 20, fontWeight: '700', color: colors.success },
  status: { fontSize: 18, fontWeight: '700', color: colors.text },
  muted: { fontSize: 15, color: colors.muted, lineHeight: 21 },
});

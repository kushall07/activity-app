import {
  AREA_NAMES,
  createPlanRequestSchema,
  PLAN_RULES,
  type CostSplit,
  type CreatePlanRequest,
  type SkillLevel,
} from '@activity/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../../auth/AppContext';
import {
  Button,
  Chips,
  ErrorText,
  Field,
  Loading,
  MultiChips,
  Screen,
  Stepper,
  Title,
  Toggle,
} from '../../components/ui';
import { draftFromPlan, emptyDraft, toRequest, type Draft } from '../../lib/planDraft';
import {
  atIstMinutes,
  COST_SPLIT_LABEL,
  formatClock,
  formatDay,
  formatDuration,
  istDayStart,
  SKILL_LABEL,
} from '../../lib/planFormat';
import { colors } from '../../theme';

const GENDERS = [
  { value: 'woman', label: 'Women' },
  { value: 'man', label: 'Men' },
  { value: 'nonbinary', label: 'Non-binary' },
] as const;
const INTENTS = [
  { value: 'friends', label: 'Friends' },
  { value: 'date', label: 'A date' },
  { value: 'either', label: 'Either' },
] as const;
const SKILLS = (Object.keys(SKILL_LABEL) as SkillLevel[]).map((v) => ({
  value: v,
  label: SKILL_LABEL[v],
}));
const SPLITS = (Object.keys(COST_SPLIT_LABEL) as CostSplit[]).map((v) => ({
  value: v,
  label: COST_SPLIT_LABEL[v],
}));
const DURATIONS = [60, 90, 120, 180, 240].map((m) => ({
  value: String(m),
  label: formatDuration(m),
}));
const STEPS = ['What', 'When and where', 'Who', 'Cost'] as const;
const DAY_MS = 24 * 3600_000;

/** Post a plan in four steps, like offering a ride. Also edits a plan (`?edit=<id>`). */
export default function PostScreen() {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setError(null);
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const activities = useQuery({
    queryKey: ['activities'],
    queryFn: api.activities,
    staleTime: 3600_000,
  });
  const editing = useQuery({
    queryKey: ['plan', edit],
    queryFn: () => api.plan(edit!),
    enabled: !!edit,
  });
  useEffect(() => {
    if (editing.data) {
      setDraft(draftFromPlan(editing.data));
      setStep(1);
    } else if (!edit) {
      setDraft(emptyDraft());
      setStep(0);
    }
  }, [editing.data, edit]);

  const [venueQuery, setVenueQuery] = useState('');
  const venues = useQuery({
    queryKey: ['venues', venueQuery, draft.activity?.slug],
    queryFn: () => api.venues({ q: venueQuery || undefined, activity: draft.activity?.slug }),
    enabled: step === 1 && draft.placeMode === 'venue',
  });

  const days = useMemo(() => {
    const today = istDayStart(new Date()).getTime();
    return Array.from({ length: 14 }, (_, i) => today + i * DAY_MS);
  }, []);

  const submit = useMutation({
    mutationFn: async (body: CreatePlanRequest) => {
      if (!edit) return api.createPlan(body);
      // The activity is fixed once posted; everything else can change.
      const patch: Partial<CreatePlanRequest> = { ...body };
      delete patch.activitySlug;
      return api.updatePlan(edit, patch);
    },
    onSuccess: async (plan) => {
      queryClient.setQueryData(['plan', plan.id], plan);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['myPlans'] }),
        queryClient.invalidateQueries({ queryKey: ['feed'] }),
      ]);
      if (edit) router.back();
      else {
        setDraft(emptyDraft());
        setStep(0);
        router.push({ pathname: '/plan/[id]', params: { id: plan.id } });
      }
    },
    onError: (err) => setError(err.message),
  });

  /** Checks the current step before moving on. */
  const next = () => {
    if (step === 0 && !draft.activity) return setError('Pick an activity');
    if (step === 1) {
      if (draft.placeMode === 'venue' && !draft.venue) return setError('Pick a venue');
      if (draft.placeMode === 'custom' && draft.placeName.trim().length < 2)
        return setError('Name the place, for example "Cubbon Park main gate"');
      const start = atIstMinutes(new Date(draft.day), draft.minutes).getTime();
      if (start < Date.now() + PLAN_RULES.minLeadMinutes * 60_000)
        return setError(`Pick a time at least ${PLAN_RULES.minLeadMinutes} minutes from now`);
    }
    if (step === 2 && draft.genders.length === 0) return setError('Choose who can join');
    if (step < STEPS.length - 1) return setStep(step + 1);

    const body = toRequest(draft);
    const parsed = createPlanRequestSchema.safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the plan');
    submit.mutate(body);
  };

  if (activities.isPending || (edit && editing.isPending)) return <Loading />;

  return (
    <Screen>
      <Title sub={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}>
        {edit ? 'Edit your plan' : 'Post a plan'}
      </Title>

      {step === 0 && (
        <View style={styles.grid}>
          {(activities.data?.activities ?? []).map((a) => {
            const selected = draft.activity?.slug === a.slug;
            return (
              <Pressable
                key={a.slug}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={a.name}
                onPress={() => {
                  set('activity', a);
                  set('seats', a.defaultSeats);
                }}
                style={[styles.tile, selected && styles.tileSelected]}
              >
                <Text style={styles.tileEmoji}>{a.emoji}</Text>
                <Text
                  style={[styles.tileText, selected && styles.tileTextSelected]}
                  numberOfLines={1}
                >
                  {a.name}
                </Text>
              </Pressable>
            );
          })}
          <ErrorText>{activities.error?.message}</ErrorText>
        </View>
      )}

      {step === 1 && (
        <>
          <Chips
            label="Day"
            options={days.map((d) => ({ value: String(d), label: formatDay(new Date(d)) }))}
            value={String(draft.day)}
            onChange={(v) => set('day', Number(v))}
          />
          <Stepper
            label="Start time"
            value={draft.minutes}
            min={6 * 60}
            max={23 * 60 + 30}
            step={30}
            onChange={(v) => set('minutes', v)}
            format={(m) => formatClock(atIstMinutes(new Date(draft.day), m))}
          />
          <Chips
            label="How long"
            options={DURATIONS}
            value={String(draft.duration)}
            onChange={(v) => set('duration', Number(v))}
          />
          <Chips
            label="Where"
            options={[
              { value: 'custom', label: 'Name a place' },
              { value: 'venue', label: 'Pick a venue' },
            ]}
            value={draft.placeMode}
            onChange={(v) => set('placeMode', v)}
          />
          {draft.placeMode === 'custom' ? (
            <>
              <Field
                label="Place"
                placeholder="e.g. Cubbon Park main gate"
                value={draft.placeName}
                onChangeText={(t) => set('placeName', t)}
                maxLength={PLAN_RULES.placeNameMaxLength}
                hint="Meet somewhere public. Never share a home address."
              />
              <Chips
                label="Area"
                options={AREA_NAMES.map((a) => ({ value: a, label: a }))}
                value={draft.area}
                onChange={(v) => set('area', v)}
              />
            </>
          ) : (
            <>
              <Field
                label="Search venues"
                placeholder="Name of the club, studio or café"
                value={venueQuery}
                onChangeText={setVenueQuery}
              />
              {(venues.data?.venues ?? []).map((v) => {
                const selected = draft.venue?.id === v.id;
                return (
                  <Pressable
                    key={v.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => set('venue', v)}
                    style={[styles.venue, selected && styles.tileSelected]}
                  >
                    <Text style={[styles.tileText, selected && styles.tileTextSelected]}>
                      {v.name}
                    </Text>
                    <Text style={styles.hint}>{v.area ?? 'Bengaluru'}</Text>
                  </Pressable>
                );
              })}
              {venues.data?.venues.length === 0 ? (
                <Text style={styles.hint}>No listed venues match. Name the place instead.</Text>
              ) : null}
            </>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <Stepper
            label="People you're looking for"
            value={draft.seats}
            min={PLAN_RULES.minSeats}
            max={PLAN_RULES.maxSeats}
            onChange={(v) => set('seats', v)}
          />
          <MultiChips
            label="Who can join"
            options={GENDERS}
            value={draft.genders}
            onChange={(v) => set('genders', v)}
          />
          <Stepper
            label="Youngest"
            value={draft.ageMin}
            min={18}
            max={draft.ageMax}
            onChange={(v) => set('ageMin', v)}
          />
          <Stepper
            label="Oldest"
            value={draft.ageMax}
            min={draft.ageMin}
            max={100}
            onChange={(v) => set('ageMax', v)}
          />
          <Chips
            label="Level"
            options={SKILLS}
            value={draft.skill}
            onChange={(v) => set('skill', v)}
          />
          <Chips
            label="Looking for"
            options={INTENTS}
            value={draft.intent}
            onChange={(v) => set('intent', v)}
          />
          <Toggle
            label="Verified members only"
            hint="Only people with the photo-verified badge can see and join."
            value={draft.verifiedOnly}
            onChange={(v) => set('verifiedOnly', v)}
          />
          <Toggle
            label="Auto-accept verified members"
            hint="Verified people who fit everything above join straight away. Great for group games."
            value={draft.autoAccept}
            onChange={(v) => set('autoAccept', v)}
          />
        </>
      )}

      {step === 3 && (
        <>
          <Chips
            label="Who pays"
            options={SPLITS}
            value={draft.costSplit}
            onChange={(v) => set('costSplit', v)}
          />
          {draft.costSplit === 'split_equally' || draft.costSplit === 'each_pays_own' ? (
            <Field
              label="Cost per person (₹, optional)"
              keyboardType="number-pad"
              value={draft.cost}
              onChangeText={(t) => set('cost', t.replace(/[^\d]/g, ''))}
              maxLength={6}
            />
          ) : null}
          <Field
            label="Note (optional)"
            placeholder="Anything people should know: bring a racket, I'll book the court…"
            multiline
            value={draft.note}
            onChangeText={(t) => set('note', t)}
            maxLength={PLAN_RULES.noteMaxLength}
            hint="No phone numbers or handles; you can chat once matched."
          />
          <View style={styles.preview}>
            <Text style={styles.previewTitle}>
              {draft.activity?.emoji} {draft.activity?.name}
            </Text>
            <Text style={styles.hint}>
              {formatDay(atIstMinutes(new Date(draft.day), draft.minutes))},{' '}
              {formatClock(atIstMinutes(new Date(draft.day), draft.minutes))} ·{' '}
              {draft.placeMode === 'venue'
                ? draft.venue?.name
                : `${draft.placeName}, ${draft.area}`}
            </Text>
            <Text style={styles.hint}>
              {draft.seats} {draft.seats === 1 ? 'person' : 'people'} · ages {draft.ageMin}–
              {draft.ageMax}
            </Text>
          </View>
        </>
      )}

      <ErrorText>{error}</ErrorText>
      <Button
        label={step < STEPS.length - 1 ? 'Next' : edit ? 'Save changes' : 'Post plan'}
        onPress={next}
        loading={submit.isPending}
      />
      {step > (edit ? 1 : 0) ? (
        <Button label="Back" variant="secondary" onPress={() => setStep(step - 1)} />
      ) : edit ? (
        <Button label="Cancel" variant="secondary" onPress={() => router.back()} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '30%',
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 4,
  },
  tileSelected: { backgroundColor: colors.text, borderColor: colors.text },
  tileEmoji: { fontSize: 28 },
  tileText: { fontSize: 14, color: colors.text, fontWeight: '600' },
  tileTextSelected: { color: colors.surface },
  venue: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 2,
  },
  hint: { fontSize: 14, color: colors.muted },
  preview: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 4,
  },
  previewTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
});

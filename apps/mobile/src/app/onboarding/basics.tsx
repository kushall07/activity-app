import {
  PROFILE_RULES,
  upsertProfileRequestSchema,
  type UpsertProfileRequest,
} from '@activity/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useApp } from '../../auth/AppContext';
import { Button, Chips, ErrorText, Field, Loading, Screen, Title } from '../../components/ui';
import { formatIndianDate, parseIndianDate } from '../../lib/dates';
import { ME_QUERY_KEY, useMe } from '../../lib/useMe';

const GENDER_OPTIONS = [
  { value: 'woman', label: 'Woman' },
  { value: 'man', label: 'Man' },
  { value: 'nonbinary', label: 'Non-binary' },
] as const;

const INTENT_OPTIONS = [
  { value: 'date', label: 'A date' },
  { value: 'friends', label: 'New friends' },
  { value: 'either', label: 'Either' },
] as const;

type Gender = (typeof GENDER_OPTIONS)[number]['value'];
type Intent = (typeof INTENT_OPTIONS)[number]['value'];

/** Profile basics. Also used later to edit the profile. */
export default function BasicsScreen() {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const me = useMe();
  const existing = me.data?.profile;

  const [name, setName] = useState('');
  const [birthday, setBirthday] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [intent, setIntent] = useState<Intent>('either');
  const [bio, setBio] = useState('');
  const [neighbourhood, setNeighbourhood] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [interests, setInterests] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!existing) return;
    setName(existing.displayName);
    setBirthday(formatIndianDate(existing.birthDate));
    setGender(existing.gender);
    setIntent(existing.intent);
    setBio(existing.bio);
    setNeighbourhood(existing.neighbourhood ?? '');
    setJobTitle(existing.jobTitle ?? '');
    setInterests(existing.interests.join(', '));
  }, [existing]);

  const save = useMutation({
    mutationFn: (p: UpsertProfileRequest) => api.saveProfile(p),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      if (existing) router.back();
      else router.replace('/onboarding/photos');
    },
  });

  const submit = () => {
    const birthDate = parseIndianDate(birthday);
    if (!birthDate) return setFormError('Enter your birthday as DD/MM/YYYY');
    if (!gender) return setFormError('Choose how you identify');
    const candidate: UpsertProfileRequest = {
      displayName: name,
      birthDate,
      gender,
      intent,
      bio,
      neighbourhood,
      jobTitle,
      interests: interests
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
    const check = upsertProfileRequestSchema.safeParse(candidate);
    if (!check.success) return setFormError(check.error.issues[0]?.message ?? 'Check your details');
    setFormError(null);
    save.mutate(candidate);
  };

  if (me.isLoading) return <Loading />;

  return (
    <Screen>
      <Title sub={existing ? undefined : 'This is what people see when you post or join a plan.'}>
        {existing ? 'Edit profile' : 'About you'}
      </Title>
      <Field
        label="First name"
        value={name}
        onChangeText={setName}
        maxLength={40}
        autoCapitalize="words"
      />
      <Field
        label="Birthday"
        value={birthday}
        onChangeText={setBirthday}
        placeholder="DD/MM/YYYY"
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        hint={`You must be ${PROFILE_RULES.minAge} or older. Only your age is shown.`}
      />
      <Chips label="I am a" options={GENDER_OPTIONS} value={gender} onChange={setGender} />
      <Chips label="Open to" options={INTENT_OPTIONS} value={intent} onChange={setIntent} />
      <Field
        label="Bio"
        value={bio}
        onChangeText={setBio}
        multiline
        maxLength={PROFILE_RULES.bioMaxLength}
        placeholder="Weekend badminton, always up for stand-up comedy…"
        hint={`${bio.length}/${PROFILE_RULES.bioMaxLength}`}
      />
      <Field
        label="Interests"
        value={interests}
        onChangeText={setInterests}
        placeholder="badminton, comedy, pottery"
        hint="Separate with commas"
      />
      <Field
        label="Neighbourhood"
        value={neighbourhood}
        onChangeText={setNeighbourhood}
        placeholder="Indiranagar"
      />
      <Field label="Job title" value={jobTitle} onChangeText={setJobTitle} />
      <ErrorText>{formError ?? save.error?.message}</ErrorText>
      <Button label={existing ? 'Save' : 'Continue'} onPress={submit} loading={save.isPending} />
    </Screen>
  );
}

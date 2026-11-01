import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Alert, Dimensions, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useApp } from '../../auth/AppContext';
import { Button, ErrorText, Loading, Screen } from '../../components/ui';
import { useMe } from '../../lib/useMe';
import { colors } from '../../theme';

const INTENT_LABEL = {
  date: 'Open to a date',
  friends: 'Here for friends',
  either: 'Date or friends',
};
const PHOTO_WIDTH = Dimensions.get('window').width - 48;

/** The member's own profile, as others will see it, plus account actions. */
export default function ProfileScreen() {
  const { api, signOut } = useApp();
  const me = useMe();

  const remove = useMutation({
    mutationFn: () => api.deleteAccount(),
    onSuccess: () => signOut(),
  });

  if (!me.data?.profile) return <Loading />;
  const { profile, photos, verification } = me.data;
  const approved = photos.filter((p) => p.urls);

  const confirmDelete = () =>
    Alert.alert(
      'Delete account?',
      'Your profile, photos and plans are deleted permanently. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => remove.mutate() },
      ],
    );

  return (
    <Screen>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        style={styles.carousel}
      >
        {approved.map((p) => (
          <Image
            key={p.id}
            source={{ uri: p.urls!.full }}
            style={styles.photo}
            accessibilityIgnoresInvertColors
          />
        ))}
      </ScrollView>
      <View style={styles.header}>
        <Text style={styles.name}>
          {profile.displayName}, {profile.age}
        </Text>
        {profile.verified && <Text style={styles.verified}>✓ Verified</Text>}
      </View>
      <Text style={styles.meta}>
        {[INTENT_LABEL[profile.intent], profile.neighbourhood, profile.jobTitle]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
      {profile.interests.length > 0 && (
        <View style={styles.tags}>
          {profile.interests.map((i) => (
            <Text key={i} style={styles.tag}>
              {i}
            </Text>
          ))}
        </View>
      )}

      <Button
        label="Edit profile"
        variant="secondary"
        onPress={() => router.push('/onboarding/basics')}
      />
      <Button
        label="Manage photos"
        variant="secondary"
        onPress={() => router.push('/onboarding/photos')}
      />
      {verification.status !== 'verified' && (
        <Button
          label="Get verified"
          variant="secondary"
          onPress={() => router.push('/onboarding/selfie')}
        />
      )}
      <Button label="Log out" variant="secondary" onPress={() => void signOut()} />
      <ErrorText>{remove.error?.message}</ErrorText>
      <Button
        label="Delete account"
        variant="danger"
        onPress={confirmDelete}
        loading={remove.isPending}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  carousel: { flexGrow: 0, borderRadius: 16 },
  photo: { width: PHOTO_WIDTH, aspectRatio: 3 / 4, borderRadius: 16, backgroundColor: '#ddd' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontSize: 28, fontWeight: '700', color: colors.text },
  verified: { color: colors.success, fontWeight: '700' },
  meta: { color: colors.muted, fontSize: 15 },
  bio: { fontSize: 16, color: colors.text, lineHeight: 23 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    overflow: 'hidden',
    color: colors.text,
  },
});

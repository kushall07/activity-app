import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useApp } from '../../auth/AppContext';
import { Button, ErrorText, Screen, Title } from '../../components/ui';
import { resizeToJpeg } from '../../lib/image';
import { uploadSelfie } from '../../lib/photoUpload';
import { ME_QUERY_KEY, useMe } from '../../lib/useMe';
import { colors } from '../../theme';

/** Optional: a live selfie compared with the profile photos earns a "verified" badge. */
export default function SelfieScreen() {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const me = useMe({ pollWhileProcessing: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = me.data?.verification.status ?? 'none';

  const take = async () => {
    setError(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return setError('Allow camera access to take a verification selfie.');
    const result = await ImagePicker.launchCameraAsync({
      cameraType: ImagePicker.CameraType.front,
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]) return;
    setBusy(true);
    try {
      await uploadSelfie(api, result.assets[0], resizeToJpeg);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    }
  };

  const done = () => router.replace('/profile');

  if (status === 'verified') {
    return (
      <Screen>
        <Title sub="People will see the verified badge on your profile.">You're verified ✓</Title>
        <Button label="Continue" onPress={done} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Title sub="Take a quick selfie. We compare it with your photos and delete it straight after.">
        Get verified
      </Title>
      <View style={styles.card}>
        <Text style={styles.tip}>• Face the camera in good light</Text>
        <Text style={styles.tip}>• No sunglasses, masks or filters</Text>
        <Text style={styles.tip}>• Only you in the frame</Text>
      </View>
      {status === 'processing' && <Text style={styles.status}>Checking your selfie…</Text>}
      {status === 'failed' && me.data?.verification.failureReason && (
        <ErrorText>{me.data.verification.failureReason}</ErrorText>
      )}
      <ErrorText>{error}</ErrorText>
      <Button
        label={status === 'failed' ? 'Try again' : 'Take selfie'}
        onPress={() => void take()}
        loading={busy || status === 'processing'}
      />
      <Button label="Maybe later" variant="secondary" onPress={done} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, gap: 6 },
  tip: { fontSize: 15, color: colors.text },
  status: { color: colors.muted },
});

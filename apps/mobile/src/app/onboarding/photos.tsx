import { PROFILE_RULES, type Photo } from '@activity/shared';
import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Text } from 'react-native';
import { useApp } from '../../auth/AppContext';
import { PhotoGrid } from '../../components/PhotoGrid';
import { Button, ErrorText, Loading, Screen, Title } from '../../components/ui';
import { resizeToJpeg } from '../../lib/image';
import { uploadProfilePhoto } from '../../lib/photoUpload';
import { ME_QUERY_KEY, useMe } from '../../lib/useMe';

export default function PhotosScreen() {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const me = useMe({ pollWhileProcessing: true });
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });

  const add = async () => {
    setError(null);
    const free =
      PROFILE_RULES.maxPhotos -
      (me.data?.photos.filter((p) => p.status !== 'rejected').length ?? 0);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: Math.max(free, 1),
      quality: 1,
    });
    if (result.canceled) return;
    const assets = result.assets.slice(0, free);
    setUploading((n) => n + assets.length);
    // Sequential keeps positions in the order the member picked them.
    for (const asset of assets) {
      try {
        await uploadProfilePhoto(api, asset, resizeToJpeg);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setUploading((n) => n - 1);
        await refresh();
      }
    }
  };

  const onPhotoPress = (photo: Photo) => {
    Alert.alert(
      photo.status === 'rejected' ? 'Photo not approved' : 'Photo',
      photo.rejectionReason ?? undefined,
      [
        ...(photo.position > 0 && photo.status === 'approved'
          ? [{ text: 'Make main photo', onPress: () => void makeMain(photo) }]
          : []),
        { text: 'Remove', style: 'destructive' as const, onPress: () => void remove(photo) },
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  };

  const remove = async (photo: Photo) => {
    try {
      await api.deletePhoto(photo.id);
    } catch (err) {
      setError((err as Error).message);
    }
    await refresh();
  };

  const makeMain = async (photo: Photo) => {
    const ids = (me.data?.photos ?? []).filter((p) => p.status !== 'rejected').map((p) => p.id);
    try {
      await api.reorderPhotos([photo.id, ...ids.filter((id) => id !== photo.id)]);
    } catch (err) {
      setError((err as Error).message);
    }
    await refresh();
  };

  if (!me.data) return <Loading />;
  const { approvedPhotos, minPhotos, complete } = me.data.onboarding;
  const editing = complete && router.canGoBack();

  return (
    <Screen>
      <Title
        sub={`Add at least ${minPhotos} photos that clearly show you. We check every photo before it goes live.`}
      >
        Your photos
      </Title>
      <PhotoGrid
        photos={me.data.photos}
        uploading={uploading}
        onAdd={() => void add()}
        onPhotoPress={onPhotoPress}
      />
      <Text>
        {approvedPhotos}/{minPhotos} approved
      </Text>
      <ErrorText>{error}</ErrorText>
      <Button
        label={editing ? 'Done' : 'Continue'}
        disabled={!complete || uploading > 0}
        onPress={() => (editing ? router.back() : router.replace('/onboarding/selfie'))}
      />
    </Screen>
  );
}

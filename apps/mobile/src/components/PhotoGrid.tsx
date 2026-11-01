import { PROFILE_RULES, type Photo } from '@activity/shared';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

type Props = {
  photos: Photo[];
  uploading: number;
  onAdd: () => void;
  onPhotoPress: (photo: Photo) => void;
};

/** Six slots: approved photos, ones being checked, rejected ones (tap to remove), then "add". */
export function PhotoGrid({ photos, uploading, onAdd, onPhotoPress }: Props) {
  const slots = Array.from({ length: PROFILE_RULES.maxPhotos }, (_, i) => i);
  const active = photos.filter((p) => p.status !== 'rejected').length;
  return (
    <View style={styles.grid}>
      {slots.map((i) => {
        const photo = photos[i];
        if (photo) {
          return (
            <Pressable
              key={photo.id}
              style={styles.slot}
              onPress={() => onPhotoPress(photo)}
              accessibilityLabel={`Photo ${i + 1}, ${photo.status}`}
            >
              {photo.urls ? (
                <Image source={{ uri: photo.urls.thumb }} style={styles.image} />
              ) : null}
              {photo.status === 'processing' && (
                <View style={styles.overlay}>
                  <ActivityIndicator color="#fff" />
                  <Text style={styles.overlayText}>Checking…</Text>
                </View>
              )}
              {photo.status === 'rejected' && (
                <View style={[styles.overlay, styles.rejected]}>
                  <Text style={styles.overlayText}>Not approved</Text>
                  <Text style={styles.overlaySmall}>Tap to remove</Text>
                </View>
              )}
              {i === 0 && photo.status === 'approved' && <Text style={styles.badge}>Main</Text>}
            </Pressable>
          );
        }
        const isUploading = i - photos.length < uploading;
        const canAdd =
          !isUploading &&
          active + uploading < PROFILE_RULES.maxPhotos &&
          i === photos.length + uploading;
        return (
          <Pressable
            key={`empty-${i}`}
            style={[styles.slot, styles.empty]}
            onPress={canAdd ? onAdd : undefined}
            disabled={!canAdd}
            accessibilityRole="button"
            accessibilityLabel={isUploading ? 'Uploading photo' : 'Add photo'}
          >
            {isUploading ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <Text style={[styles.plus, !canAdd && styles.dim]}>+</Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  slot: {
    width: '31%',
    aspectRatio: 3 / 4,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#ddd',
  },
  empty: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: 6,
  },
  rejected: { backgroundColor: 'rgba(214,69,69,0.85)' },
  overlayText: { color: '#fff', fontWeight: '600', textAlign: 'center' },
  overlaySmall: { color: '#fff', fontSize: 12 },
  badge: {
    position: 'absolute',
    left: 6,
    top: 6,
    backgroundColor: colors.accent,
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
  },
  plus: { fontSize: 32, color: colors.accent },
  dim: { color: colors.border },
});

import { BENGALURU_AREAS, latLngSchema } from '@activity/shared';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

export interface Origin {
  lat: number;
  lng: number;
  /** What to show the member: "Near you" or the neighbourhood we fell back to. */
  label: string;
  precise: boolean;
}

const CITY_CENTRE = BENGALURU_AREAS.find((a) => a.name === 'MG Road')!;

/** The member's neighbourhood centre, or the city centre. */
export function fallbackOrigin(neighbourhood?: string | null): Origin {
  const area =
    BENGALURU_AREAS.find((a) => a.name.toLowerCase() === neighbourhood?.trim().toLowerCase()) ??
    CITY_CENTRE;
  return { lat: area.lat, lng: area.lng, label: `Around ${area.name}`, precise: false };
}

/**
 * Where to search from. Uses the phone's location when the member allows it
 * and is in Bengaluru (the only launch city); otherwise their neighbourhood.
 * Coarse accuracy is enough for a feed and is kinder to battery and privacy.
 * Pass `undefined` while the profile is loading.
 */
export function useFeedOrigin(neighbourhood: string | null | undefined): Origin | null {
  const [origin, setOrigin] = useState<Origin | null>(null);

  useEffect(() => {
    // Wait for the profile, so the fallback is their neighbourhood and not a guess.
    if (neighbourhood === undefined) return;
    let cancelled = false;
    (async () => {
      try {
        const { granted } = await Location.requestForegroundPermissionsAsync();
        if (!granted) throw new Error('denied');
        const pos =
          (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 })) ??
          (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
        const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (!latLngSchema.safeParse(point).success) throw new Error('outside Bengaluru');
        if (!cancelled) setOrigin({ ...point, label: 'Near you', precise: true });
      } catch {
        if (!cancelled) setOrigin(fallbackOrigin(neighbourhood));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [neighbourhood]);

  return origin;
}

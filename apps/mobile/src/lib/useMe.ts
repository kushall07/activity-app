import { useQuery } from '@tanstack/react-query';
import { useApp } from '../auth/AppContext';

export const ME_QUERY_KEY = ['me'] as const;

/** The signed-in member's account, profile, photos and onboarding state. */
export function useMe(options: { pollWhileProcessing?: boolean } = {}) {
  const { api, status } = useApp();
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: api.me,
    enabled: status === 'signedIn',
    // While photos are being moderated or a selfie is being checked, poll for the result.
    refetchInterval: (query) => {
      if (!options.pollWhileProcessing) return false;
      const me = query.state.data;
      const busy =
        me?.photos.some((p) => p.status === 'processing') ||
        me?.verification.status === 'processing';
      return busy ? 2000 : false;
    },
  });
}

/** Which screen a signed-in member should land on. */
export function nextRoute(me: { onboarding: { hasProfile: boolean; complete: boolean } }) {
  if (!me.onboarding.hasProfile) return '/onboarding/basics' as const;
  if (!me.onboarding.complete) return '/onboarding/photos' as const;
  return '/explore' as const;
}

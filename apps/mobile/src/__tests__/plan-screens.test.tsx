import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { AppProvider } from '../auth/AppContext';
import { memoryStorage, Session } from '../lib/session';
import ExploreScreen from '../app/(tabs)/explore';
import PostScreen from '../app/(tabs)/post';
import { JoinPanel } from '../components/JoinPanel';

jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: async () => ({ granted: false }),
  Accuracy: { Balanced: 3 },
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

const USER = '6f1c1b0e-8f5e-4b8a-9a7e-1b2c3d4e5f60';
const PLAN_ID = '0b5c6a7d-1e2f-4a3b-8c9d-0e1f2a3b4c5d';
// Explore chains three async steps (profile, location, feed); CI runners need more than the 1 s default.
const SLOW = { timeout: 5000 };
const json = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

const me = {
  user: { id: USER, phone: '+919876543210', createdAt: '2030-01-01T00:00:00Z' },
  profile: {
    displayName: 'Ananya',
    birthDate: '1996-04-12',
    age: 34,
    gender: 'woman',
    intent: 'friends',
    bio: '',
    jobTitle: null,
    education: null,
    neighbourhood: 'Indiranagar',
    heightCm: null,
    interests: [],
    verified: true,
  },
  photos: [],
  verification: { status: 'verified', failureReason: null },
  onboarding: { hasProfile: true, approvedPhotos: 3, minPhotos: 3, complete: true },
};

const badminton = {
  slug: 'badminton',
  name: 'Badminton',
  category: 'sport',
  emoji: '🏸',
  defaultSeats: 3,
};

const plan = {
  id: PLAN_ID,
  activity: badminton,
  place: { venueId: null, name: 'Community court', area: 'Indiranagar', lat: 12.97, lng: 77.64 },
  startsAt: '2030-11-02T13:30:00Z',
  endsAt: '2030-11-02T15:00:00Z',
  durationMinutes: 90,
  seats: { total: 3, taken: 0, open: 3 },
  wantedGenders: ['woman', 'man'],
  genderMix: null,
  ageMin: 18,
  ageMax: 45,
  skillLevel: 'any',
  intent: 'either',
  costSplit: 'split_equally',
  costPerPersonInr: 300,
  verifiedOnly: false,
  autoAccept: false,
  note: '',
  status: 'open',
  distanceKm: 0.4,
  host: {
    userId: USER,
    displayName: 'Rohan',
    age: 31,
    gender: 'man',
    verified: true,
    photoUrl: null,
  },
  isMine: false,
  myRequest: null,
  pendingRequests: null,
  chatId: null,
  createdAt: '2030-11-01T10:00:00Z',
};

/** Routes the mocked fetch by path, recording each call. */
function mockApi(routes: Record<string, (init?: RequestInit) => Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const key = `${init?.method ?? 'GET'} ${path}`;
    const handler = routes[key];
    if (!handler) throw new Error(`Unexpected request ${key}`);
    return handler(init);
  }) as unknown as typeof fetch;
  return calls;
}

async function wrap(ui: ReactNode) {
  const session = new Session(memoryStorage());
  await session.signIn({ accessToken: 'at', refreshToken: 'rt', expiresIn: 3600 });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AppProvider session={session}>{ui}</AppProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => jest.clearAllMocks());

describe('ExploreScreen', () => {
  it('loads plans around the member’s neighbourhood when location is off', async () => {
    const calls = mockApi({
      'GET /v1/me': () => json(200, me),
      'GET /v1/plans': () => json(200, { plans: [plan], nextCursor: null }),
    });
    await wrap(<ExploreScreen />);

    expect(await screen.findByText('Badminton', {}, SLOW)).toBeTruthy();
    expect(screen.getByText(/Around Indiranagar/)).toBeTruthy();
    expect(screen.getByText(/Community court · Indiranagar · 400 m/)).toBeTruthy();

    const feedCall = calls.find((c) => c.url.includes('/v1/plans'))!;
    const q = new URL(feedCall.url).searchParams;
    expect([q.get('lat'), q.get('lng'), q.get('radiusKm'), q.get('sort')]).toEqual([
      '12.9719',
      '77.6412',
      '10',
      'soonest',
    ]);

    await fireEvent.press(screen.getByText('Rohan, 31'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/plan/[id]',
      params: { id: PLAN_ID, lat: '12.9719', lng: '77.6412' },
    });
  });

  it('refetches with a category filter', async () => {
    const calls = mockApi({
      'GET /v1/me': () => json(200, me),
      'GET /v1/plans': () => json(200, { plans: [], nextCursor: null }),
    });
    await wrap(<ExploreScreen />);
    expect(await screen.findByText('No plans here yet', {}, SLOW)).toBeTruthy();
    await fireEvent.press(screen.getByText('🎤 Shows'));
    await waitFor(() => expect(calls.some((c) => c.url.includes('categories=show'))).toBe(true));
  });
});

describe('PostScreen', () => {
  it('walks the four steps and posts the plan', async () => {
    const calls = mockApi({
      'GET /v1/activities': () => json(200, { activities: [badminton] }),
      'POST /v1/plans': () => json(201, { ...plan, isMine: true }),
    });
    await wrap(<PostScreen />);

    await fireEvent.press(await screen.findByLabelText('Badminton', {}, SLOW));
    await fireEvent.press(screen.getByText('Next'));

    // Step 2: tomorrow, a named place.
    await fireEvent.press(screen.getByText('Tomorrow'));
    await fireEvent.changeText(screen.getByLabelText('Place'), 'Community court');
    await fireEvent.press(screen.getByText('Indiranagar'));
    await fireEvent.press(screen.getByText('Next'));

    // Step 3: women only, verified only.
    await fireEvent.press(screen.getByText('Men'));
    await fireEvent.press(screen.getByLabelText("Increase People you're looking for"));
    await fireEvent(screen.getByLabelText('Verified members only'), 'valueChange', true);
    await fireEvent.press(screen.getByText('Next'));

    // Step 4: split, ₹300 each.
    await fireEvent.press(screen.getByText('Split equally'));
    await fireEvent.changeText(screen.getByLabelText('Cost per person (₹, optional)'), '300');
    await fireEvent.press(screen.getByText('Post plan'));

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith({ pathname: '/plan/[id]', params: { id: PLAN_ID } }),
    );
    const post = calls.find((c) => c.init?.method === 'POST')!;
    const body = JSON.parse(String(post.init!.body));
    expect(body).toMatchObject({
      activitySlug: 'badminton',
      venueId: null,
      place: { name: 'Community court', area: 'Indiranagar' },
      durationMinutes: 90,
      seatsTotal: 4,
      wantedGenders: ['woman'],
      verifiedOnly: true,
      costSplit: 'split_equally',
      costPerPersonInr: 300,
    });
    // 7:00 pm IST.
    expect(body.startsAt).toMatch(/T13:30:00\.000Z$/);
  });

  it('stops on a step until it is complete', async () => {
    mockApi({ 'GET /v1/activities': () => json(200, { activities: [badminton] }) });
    await wrap(<PostScreen />);
    await screen.findByLabelText('Badminton', {}, SLOW);
    await fireEvent.press(screen.getByText('Next'));
    expect(screen.getByText('Pick an activity')).toBeTruthy();
  });
});

describe('JoinPanel', () => {
  const REQUEST_ID = '9a8b7c6d-1e2f-4a3b-8c9d-0e1f2a3b4c5d';

  it("sends an I'm in request with a note and shows it as requested", async () => {
    const requested = {
      ...plan,
      myRequest: { id: REQUEST_ID, status: 'pending', expiresAt: '2030-11-02T10:00:00.000Z' },
    };
    const calls = mockApi({
      [`POST /v1/plans/${PLAN_ID}/requests`]: () =>
        json(201, { request: { id: REQUEST_ID, status: 'pending' }, plan: requested }),
    });
    await wrap(<JoinPanel plan={plan as never} />);
    fireEvent.press(screen.getByText("I'm in"));
    fireEvent.changeText(
      await screen.findByLabelText('Say something (optional)'),
      'Bringing shuttles',
    );
    await screen.findByDisplayValue('Bringing shuttles');
    fireEvent.press(screen.getByText('Send request'));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ message: 'Bringing shuttles' });
  });

  it('shows a waiting request with a way to withdraw', async () => {
    mockApi({});
    await wrap(
      <JoinPanel
        plan={
          {
            ...plan,
            myRequest: { id: REQUEST_ID, status: 'pending', expiresAt: '2030-11-02T10:00:00.000Z' },
          } as never
        }
      />,
    );
    expect(await screen.findByText('Requested')).toBeTruthy();
    expect(screen.getByText('Withdraw request')).toBeTruthy();
  });

  it('offers the chat once accepted', async () => {
    mockApi({});
    await wrap(
      <JoinPanel
        plan={
          {
            ...plan,
            chatId: PLAN_ID,
            myRequest: {
              id: REQUEST_ID,
              status: 'accepted',
              expiresAt: '2030-11-02T10:00:00.000Z',
            },
          } as never
        }
      />,
    );
    fireEvent.press(await screen.findByText('Open chat'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: PLAN_ID } });
  });
});

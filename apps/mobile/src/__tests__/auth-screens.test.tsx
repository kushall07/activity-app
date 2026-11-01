import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { AppProvider } from '../auth/AppContext';
import { memoryStorage, Session } from '../lib/session';
import LoginScreen from '../app/login';
import VerifyScreen from '../app/verify';

jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ phone: '+919876543210', challengeId: 'ch-1', resendAfter: '30' }),
  Link: ({ children }: { children: ReactNode }) => {
    const { Text } = jest.requireActual('react-native');
    return <Text>{children}</Text>;
  },
}));

const json = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

function wrap(ui: ReactNode, session = new Session(memoryStorage())) {
  // gcTime Infinity: no garbage-collection timers left running after a test.
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AppProvider session={session}>{ui}</AppProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => jest.clearAllMocks());

describe('LoginScreen', () => {
  it('normalises the number, requests a code and opens the code screen', async () => {
    globalThis.fetch = jest.fn(async () =>
      json(200, { challengeId: 'ch-1', expiresIn: 180, resendAfter: 30 }),
    ) as unknown as typeof fetch;
    await wrap(<LoginScreen />);

    const send = screen.getByText('Send code');
    await fireEvent.changeText(screen.getByLabelText('Mobile number'), '98765 43210');
    await fireEvent.press(send);

    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith({
        pathname: '/verify',
        params: { phone: '+919876543210', challengeId: 'ch-1', resendAfter: '30' },
      }),
    );
    const [, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ phone: '+919876543210' });
  });

  it('keeps the button disabled for an invalid number', async () => {
    globalThis.fetch = jest.fn() as unknown as typeof fetch;
    await wrap(<LoginScreen />);
    await fireEvent.changeText(screen.getByLabelText('Mobile number'), '12345');
    await fireEvent.press(screen.getByText('Send code'));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('VerifyScreen', () => {
  it('submits when six digits are entered and signs in', async () => {
    globalThis.fetch = jest.fn(async () =>
      json(200, {
        accessToken: 'at',
        refreshToken: 'rt',
        expiresIn: 3600,
        user: { id: '6f1c1b0e-8f5e-4b8a-9a7e-1b2c3d4e5f60', isNew: true },
      }),
    ) as unknown as typeof fetch;
    const session = new Session(memoryStorage());
    await wrap(<VerifyScreen />, session);

    await fireEvent.changeText(screen.getByLabelText('6-digit code'), '123 456');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(session.getRefreshToken()).toBe('rt');
    const [, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ challengeId: 'ch-1', code: '123456' });
  });

  it('shows the error for a wrong code', async () => {
    globalThis.fetch = jest.fn(async () =>
      json(400, { statusCode: 400, code: 'otp_invalid_code', message: 'That code is not right' }),
    ) as unknown as typeof fetch;
    await wrap(<VerifyScreen />);
    await fireEvent.changeText(screen.getByLabelText('6-digit code'), '111111');
    expect(await screen.findByText('That code is not right')).toBeTruthy();
  });
});

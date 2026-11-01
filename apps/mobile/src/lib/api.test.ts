import { ApiError, createApiClient } from './api';
import { memoryStorage, Session } from './session';

const body = {
  status: 'ok',
  service: 'api',
  version: '0.1.0',
  uptimeSeconds: 5,
  timestamp: '2026-11-01T00:00:00.000Z',
  checks: { postgres: { status: 'up', latencyMs: 2 }, redis: { status: 'up', latencyMs: 1 } },
};

const res = (status: number, json: unknown = {}) =>
  ({ ok: status < 400, status, json: async () => json }) as Response;
const respond = (status: number, json: unknown) => jest.fn(async () => res(status, json));

describe('api client', () => {
  it('calls the readiness endpoint and returns the validated body', async () => {
    const fetchImpl = respond(200, body);
    const client = createApiClient('http://api.test', fetchImpl);
    await expect(client.health()).resolves.toMatchObject({ status: 'ok' });
    expect(fetchImpl).toHaveBeenCalledWith('http://api.test/health/ready', expect.anything());
  });

  it('still returns a degraded body on 503', async () => {
    const client = createApiClient(
      'http://api.test',
      respond(503, { ...body, status: 'degraded' }),
    );
    await expect(client.health()).resolves.toMatchObject({ status: 'degraded' });
  });

  it('throws ApiError on other error statuses', async () => {
    const client = createApiClient('http://api.test', respond(500, {}));
    await expect(client.health()).rejects.toBeInstanceOf(ApiError);
  });

  it('throws when the response does not match the contract', async () => {
    const client = createApiClient('http://api.test', respond(200, { hello: 'world' }));
    await expect(client.health()).rejects.toThrow(/Unexpected response/);
  });

  it('wraps network failures with the API url', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('Network request failed');
    });
    const client = createApiClient('http://api.test', fetchImpl);
    await expect(client.health()).rejects.toThrow(
      /Could not reach the server.*Network request failed/,
    );
  });

  it('surfaces the API error code and message', async () => {
    const client = createApiClient(
      'http://api.test',
      respond(400, {
        statusCode: 400,
        code: 'otp_invalid_code',
        message: 'That code is not right',
      }),
    );
    await expect(client.verifyOtp('c', '111111')).rejects.toMatchObject({
      status: 400,
      code: 'otp_invalid_code',
      message: 'That code is not right',
    });
  });
});

describe('authenticated requests', () => {
  const tokens = { accessToken: 'old', refreshToken: 'rt', expiresIn: 3600 };
  const me = {
    user: { id: '6f1c1b0e-8f5e-4b8a-9a7e-1b2c3d4e5f60', phone: '+919876543210', createdAt: 'x' },
    profile: null,
    photos: [],
    verification: { status: 'none', failureReason: null },
    onboarding: { hasProfile: false, approvedPhotos: 0, minPhotos: 3, complete: false },
  };

  it('refreshes an expired access token once and retries', async () => {
    const session = new Session(memoryStorage());
    await session.signIn(tokens);
    const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>)?.authorization;
      if (url.endsWith('/v1/auth/refresh')) return res(200, { ...tokens, accessToken: 'new' });
      return auth === 'Bearer new' ? res(200, me) : res(401);
    });
    const client = createApiClient(
      'http://api.test',
      fetchImpl as unknown as typeof fetch,
      session,
    );
    await expect(client.me()).resolves.toMatchObject({ onboarding: { complete: false } });
    expect(session.getAccessToken()).toBe('new');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('signs out when the refresh token is rejected', async () => {
    const session = new Session(memoryStorage());
    await session.signIn(tokens);
    const fetchImpl = jest.fn(async () =>
      res(401, { statusCode: 401, message: 'Session expired' }),
    );
    const client = createApiClient(
      'http://api.test',
      fetchImpl as unknown as typeof fetch,
      session,
    );
    await expect(client.me()).rejects.toBeInstanceOf(ApiError);
    expect(session.status).toBe('signedOut');
  });

  it('uses the stored refresh token after an app restart', async () => {
    const session = new Session(memoryStorage('rt'));
    await session.restore();
    expect(session.status).toBe('signedIn');
    const fetchImpl = jest.fn(async (url: string) =>
      url.endsWith('/v1/auth/refresh') ? res(200, tokens) : res(200, me),
    );
    const client = createApiClient(
      'http://api.test',
      fetchImpl as unknown as typeof fetch,
      session,
    );
    await client.me();
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://api.test/v1/auth/refresh');
  });
});

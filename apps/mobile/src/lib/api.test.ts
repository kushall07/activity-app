import { ApiError, createApiClient } from './api';

const body = {
  status: 'ok',
  service: 'api',
  version: '0.1.0',
  uptimeSeconds: 5,
  timestamp: '2026-11-01T00:00:00.000Z',
  checks: { postgres: { status: 'up', latencyMs: 2 }, redis: { status: 'up', latencyMs: 1 } },
};

const respond = (status: number, json: unknown) =>
  jest.fn(async () => ({ ok: status < 400, status, json: async () => json }) as Response);

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
    await expect(client.health()).rejects.toThrow(/Unexpected response shape/);
  });

  it('wraps network failures with the API url', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('Network request failed');
    });
    const client = createApiClient('http://api.test', fetchImpl);
    await expect(client.health()).rejects.toThrow(/http:\/\/api.test.*Network request failed/);
  });
});

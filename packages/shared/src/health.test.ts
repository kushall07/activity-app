import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './health.js';

describe('healthResponseSchema', () => {
  it('accepts a ready response with dependency checks', () => {
    const parsed = healthResponseSchema.parse({
      status: 'ok',
      service: 'api',
      version: '0.1.0',
      uptimeSeconds: 12,
      timestamp: new Date().toISOString(),
      checks: { postgres: { status: 'up', latencyMs: 3, detail: 'postgis 3.4' } },
    });
    expect(parsed.checks?.postgres?.status).toBe('up');
  });

  it('rejects an unknown status', () => {
    expect(() =>
      healthResponseSchema.parse({
        status: 'maybe',
        service: 'api',
        version: '0.1.0',
        uptimeSeconds: 1,
        timestamp: 'now',
      }),
    ).toThrow();
  });
});

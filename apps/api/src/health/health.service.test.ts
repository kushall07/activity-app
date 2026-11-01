import { describe, expect, it, vi } from 'vitest';
import { healthResponseSchema } from '@activity/shared';
import type { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Env } from '../config/env.js';
import { HealthService } from './health.service.js';

const config = { get: () => '9.9.9' } as unknown as ConfigService<Env, true>;

function make(opts: { pg?: () => Promise<unknown>; redis?: () => Promise<unknown> }) {
  const pool = {
    query: vi.fn(opts.pg ?? (async () => ({ rows: [{ v: '3.4.3' }] }))),
  } as unknown as pg.Pool;
  const redis = { ping: vi.fn(opts.redis ?? (async () => 'PONG')) } as unknown as Redis;
  return new HealthService(pool, redis, config);
}

describe('HealthService', () => {
  it('liveness does not touch dependencies and matches the shared contract', () => {
    const pgQuery = vi.fn();
    const svc = make({ pg: pgQuery });
    const res = svc.liveness();
    expect(pgQuery).not.toHaveBeenCalled();
    expect(healthResponseSchema.parse(res).version).toBe('9.9.9');
  });

  it('readiness is ok when postgres and redis respond', async () => {
    const res = await make({}).readiness();
    expect(res.status).toBe('ok');
    expect(res.checks?.postgres).toMatchObject({ status: 'up', detail: 'postgis 3.4.3' });
    expect(res.checks?.redis?.status).toBe('up');
  });

  it('readiness is degraded when a dependency fails', async () => {
    const res = await make({
      redis: async () => {
        throw new Error('ECONNREFUSED');
      },
    }).readiness();
    expect(res.status).toBe('degraded');
    expect(res.checks?.redis).toMatchObject({ status: 'down', detail: 'ECONNREFUSED' });
    expect(res.checks?.postgres?.status).toBe('up');
  });
});

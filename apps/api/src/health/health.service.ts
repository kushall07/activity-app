import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DependencyStatus, HealthResponse } from '@activity/shared';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Env } from '../config/env.js';
import { PG_POOL } from '../database/database.constants.js';
import { REDIS } from '../redis/redis.constants.js';

const CHECK_TIMEOUT_MS = 2_000;

async function timed(fn: () => Promise<string | undefined>): Promise<DependencyStatus> {
  const started = performance.now();
  try {
    const detail = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timed out')), CHECK_TIMEOUT_MS).unref(),
      ),
    ]);
    return { status: 'up', latencyMs: Math.round(performance.now() - started), detail };
  } catch (err) {
    return {
      status: 'down',
      latencyMs: Math.round(performance.now() - started),
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Liveness: the process is up. Never touches dependencies, so a DB blip doesn't kill tasks. */
  liveness(): HealthResponse {
    return this.base('ok');
  }

  /** Readiness: dependencies reachable. Used by the mobile app status screen and deploy smoke tests. */
  async readiness(): Promise<HealthResponse> {
    const [postgres, redis] = await Promise.all([
      timed(async () => {
        const { rows } = await this.pool.query<{ v: string }>('select postgis_lib_version() as v');
        return `postgis ${rows[0]?.v ?? 'unknown'}`;
      }),
      timed(async () => {
        await this.redis.ping();
        return undefined;
      }),
    ]);
    const checks = { postgres, redis };
    const allUp = Object.values(checks).every((c) => c.status === 'up');
    return { ...this.base(allUp ? 'ok' : 'degraded'), checks };
  }

  private base(status: HealthResponse['status']): HealthResponse {
    return {
      status,
      service: 'api',
      version: this.config.get('SERVICE_VERSION', { infer: true }),
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}

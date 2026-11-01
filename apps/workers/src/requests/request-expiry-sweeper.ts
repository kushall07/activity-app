import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import type { Env } from '../config/env.js';
import { DRIZZLE, type Database } from '../infra/database.js';

/** One sweeper at a time across all worker tasks. */
const LOCK_ID = 7_301_002;
const BATCH = 1000;

/**
 * Marks waiting requests as expired once their time is up (24 h, or the plan
 * started). Reads already treat them as expired, so this only keeps the stored
 * state tidy for the request stack's index and for analytics.
 */
@Injectable()
export class RequestExpirySweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RequestExpirySweeper.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    const everyMs = this.config.get('REQUEST_SWEEP_INTERVAL_SECONDS', { infer: true }) * 1000;
    const tick = () => {
      this.running ??= this.sweep()
        .then(() => undefined)
        .catch((err: unknown) => this.logger.error(`Sweep failed: ${(err as Error).message}`))
        .finally(() => (this.running = null));
    };
    this.timer = setInterval(tick, everyMs);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  /** Returns how many requests expired, or null if another task holds the lock. */
  async sweep(): Promise<number | null> {
    return this.db.transaction(async (tx) => {
      const lock = await tx.execute<{ ok: boolean }>(
        sql`select pg_try_advisory_xact_lock(${LOCK_ID}) as ok`,
      );
      if (!lock.rows[0]?.ok) return null;
      const res = await tx.execute(sql`
        update plan_requests set status = 'expired', updated_at = now()
        where id in (
          select id from plan_requests
          where status = 'pending' and expires_at <= now()
          order by expires_at
          limit ${BATCH}
        )`);
      const n = res.rowCount ?? 0;
      if (n) this.logger.log(`Expired ${n} request(s)`);
      return n;
    });
  }
}

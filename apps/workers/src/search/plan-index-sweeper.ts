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
import { PlanIndexer } from './plan-indexer.js';

/** Arbitrary constant: one sweeper at a time across all worker tasks. */
const SWEEP_LOCK_ID = 7_301_001;
const BATCH = 200;
const HOUSEKEEPING_EVERY_MS = 60 * 60_000;

/**
 * The safety net behind the `plan.index` jobs. Any plan whose version is ahead
 * of what was indexed (a lost enqueue, an OpenSearch outage, a crash) gets
 * indexed here, so the index always converges on Postgres within one interval.
 * Also drops documents for plans that ended, once an hour.
 */
@Injectable()
export class PlanIndexSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PlanIndexSweeper.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private lastHousekeeping = 0;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly indexer: PlanIndexer,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.indexer.enabled) return;
    const everyMs = this.config.get('SEARCH_SWEEP_INTERVAL_SECONDS', { infer: true }) * 1000;
    const tick = () => {
      this.running ??= this.sweep()
        .catch((err: unknown) => this.logger.error(`Sweep failed: ${(err as Error).message}`))
        .then(() => undefined)
        .finally(() => (this.running = null));
    };
    this.timer = setInterval(tick, everyMs);
    this.timer.unref();
    tick();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  /** Returns how many plans were synced, or null if another task holds the lock. */
  async sweep(): Promise<number | null> {
    return this.db.transaction(async (tx) => {
      const lock = await tx.execute<{ ok: boolean }>(
        sql`select pg_try_advisory_xact_lock(${SWEEP_LOCK_ID}) as ok`,
      );
      if (!lock.rows[0]?.ok) return null;

      const pending = await tx.execute<{ id: string }>(
        sql`select id from plans where version > indexed_version order by updated_at limit ${BATCH}`,
      );
      let synced = 0;
      for (const { id } of pending.rows) {
        try {
          await this.indexer.sync(id);
          synced++;
        } catch (err) {
          this.logger.warn(`Could not index plan ${id}: ${(err as Error).message}`);
        }
      }
      if (synced) this.logger.log(`Indexed ${synced} plan(s) the queue missed`);

      if (Date.now() - this.lastHousekeeping > HOUSEKEEPING_EVERY_MS) {
        const removed = await this.indexer.deleteEnded(new Date(Date.now() - 3600_000));
        this.lastHousekeeping = Date.now();
        if (removed) this.logger.log(`Removed ${removed} ended plan(s) from search`);
      }
      return synced;
    });
  }
}

import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Env } from '../config/env.js';
import { DRIZZLE, PG_POOL } from './database.constants.js';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const pool = new pg.Pool({
          connectionString: config.get('DATABASE_URL', { infer: true }),
          max: config.get('DATABASE_POOL_MAX', { infer: true }),
          ssl: config.get('DATABASE_SSL', { infer: true })
            ? { rejectUnauthorized: true }
            : undefined,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
          // Protects the DB from runaway queries; override per-query when needed.
          statement_timeout: 10_000,
          application_name: 'activity-api',
        });
        const logger = new Logger('Postgres');
        pool.on('error', (err) => logger.error(`Idle client error: ${err.message}`));
        return pool;
      },
    },
    {
      provide: DRIZZLE,
      inject: [PG_POOL],
      useFactory: (pool: pg.Pool): Database => drizzle(pool, { schema }),
    },
  ],
  exports: [PG_POOL, DRIZZLE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

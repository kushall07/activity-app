/**
 * Applies pending SQL migrations. Run as a one-off ECS task (or locally via
 * `pnpm db:migrate`) before rolling out a new API version. Migrations must be
 * backwards compatible with the version currently serving traffic.
 */
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { resolveDatabaseUrl } from '@activity/db';

const url = resolveDatabaseUrl(process.env);
if (!url) {
  console.error('DATABASE_URL (or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD) is required');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: url,
  max: 1,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
});

try {
  await migrate(drizzle(pool), {
    migrationsFolder: fileURLToPath(new URL('./migrations', import.meta.url)),
  });
  console.log('Migrations applied');
} catch (err) {
  console.error('Migration failed', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}

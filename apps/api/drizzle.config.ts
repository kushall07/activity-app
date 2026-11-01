import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: '../../packages/db/src/schema.ts',
  out: './src/database/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://activity:activity@localhost:5432/activity',
  },
  // PostGIS owns these; never let drizzle-kit try to manage them.
  extensionsFilters: ['postgis'],
  strict: true,
  verbose: true,
});

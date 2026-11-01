import { z } from 'zod';
import { resolveDatabaseUrl } from './database-url.js';

const booleanish = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SERVICE_VERSION: z.string().default('0.1.0'),

  /** Either DATABASE_URL, or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD (see database-url.ts). */
  DATABASE_URL: z
    .string()
    .url({ message: 'DATABASE_URL (or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD) is required' }),
  /** Max connections per API task. Keep tasks x pool below RDS max_connections (use RDS Proxy at scale). */
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_SSL: booleanish.default(false),

  REDIS_URL: z.string().url(),

  /** Comma-separated list of allowed CORS origins. Empty = no browser origins allowed. */
  CORS_ORIGINS: z.string().default(''),
  TRUST_PROXY: booleanish.default(true),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse({ ...raw, DATABASE_URL: resolveDatabaseUrl(raw) });
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

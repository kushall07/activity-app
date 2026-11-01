import { z } from 'zod';
import { resolveDatabaseUrl } from '@activity/db';

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

  AWS_REGION: z.string().default('ap-south-1'),

  // --- Auth ---------------------------------------------------------------
  /**
   * `cognito` in every deployed environment. `dev` issues local JWTs and accepts a fixed
   * OTP so the app runs without AWS; it is refused when NODE_ENV=production.
   */
  AUTH_PROVIDER: z.enum(['cognito', 'dev']).default('dev'),
  COGNITO_USER_POOL_ID: z.string().optional(),
  COGNITO_CLIENT_ID: z.string().optional(),
  /** The API is a confidential Cognito client; the secret comes from Secrets Manager. */
  COGNITO_CLIENT_SECRET: z.string().optional(),
  DEV_AUTH_SECRET: z.string().min(32).optional(),
  DEV_OTP_CODE: z
    .string()
    .regex(/^\d{6}$/)
    .default('000000'),
  /** Comma-separated E.164 country prefixes allowed to sign up (limits SMS fraud). */
  ALLOWED_PHONE_PREFIXES: z.string().default('+91'),
  OTP_MAX_PER_PHONE_PER_HOUR: z.coerce.number().int().positive().default(5),
  OTP_MAX_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(30),

  // --- Storage and jobs ----------------------------------------------------
  PHOTOS_BUCKET: z.string().min(1),
  /** Base URL photos are served from: the CloudFront domain in AWS. */
  PHOTOS_PUBLIC_BASE_URL: z.string().url(),
  /** Only set locally (S3 emulator). */
  S3_ENDPOINT: z.string().url().optional(),
  SQS_ENDPOINT: z.string().url().optional(),
  SQS_JOBS_QUEUE_URL: z.string().url(),
});

const refinedEnvSchema = envSchema.superRefine((env, ctx) => {
  if (env.AUTH_PROVIDER === 'cognito') {
    for (const key of [
      'COGNITO_USER_POOL_ID',
      'COGNITO_CLIENT_ID',
      'COGNITO_CLIENT_SECRET',
    ] as const) {
      if (!env[key])
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required when AUTH_PROVIDER=cognito`,
        });
    }
  }
  if (env.AUTH_PROVIDER === 'dev') {
    if (env.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_PROVIDER'],
        message: 'AUTH_PROVIDER=dev is not allowed in production',
      });
    }
    if (!env.DEV_AUTH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEV_AUTH_SECRET'],
        message: 'DEV_AUTH_SECRET (32+ chars) is required when AUTH_PROVIDER=dev',
      });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = refinedEnvSchema.safeParse({ ...raw, DATABASE_URL: resolveDatabaseUrl(raw) });
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

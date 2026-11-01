import { resolveDatabaseUrl } from '@activity/db';
import { z } from 'zod';

const booleanish = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  AWS_REGION: z.string().default('ap-south-1'),
  /** Only set locally (ElasticMQ). In AWS the SDK resolves the regional endpoint. */
  SQS_ENDPOINT: z.string().url().optional(),
  SQS_JOBS_QUEUE_URL: z.string().url(),
  /** Messages processed in parallel per task (SQS max batch is 10). */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(10),
  /** Long-poll wait; 20s minimises empty receives (and cost). */
  SQS_WAIT_SECONDS: z.coerce.number().int().min(0).max(20).default(20),

  /** Either DATABASE_URL, or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD (injected on ECS). */
  DATABASE_URL: z
    .string()
    .url({ message: 'DATABASE_URL (or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD) is required' }),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(5),
  DATABASE_SSL: booleanish.default(false),

  PHOTOS_BUCKET: z.string().min(1),
  /** Only set locally (S3 emulator). */
  S3_ENDPOINT: z.string().url().optional(),

  /** `rekognition` in AWS. `none` approves everything and is refused in production. */
  MODERATION_PROVIDER: z.enum(['rekognition', 'none']).default('none'),
  /** Minimum Rekognition confidence (0-100) for a moderation label to count. */
  MODERATION_MIN_CONFIDENCE: z.coerce.number().min(50).max(100).default(80),
  /** Face similarity (0-100) a selfie needs against a profile photo to verify. */
  SELFIE_MATCH_THRESHOLD: z.coerce.number().min(80).max(100).default(95),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema
    .superRefine((env, ctx) => {
      if (env.NODE_ENV === 'production' && env.MODERATION_PROVIDER === 'none') {
        ctx.addIssue({
          code: 'custom',
          path: ['MODERATION_PROVIDER'],
          message: 'MODERATION_PROVIDER=none is not allowed in production',
        });
      }
    })
    .safeParse({ ...raw, DATABASE_URL: resolveDatabaseUrl(raw) });
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

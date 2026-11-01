import { z } from 'zod';

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
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

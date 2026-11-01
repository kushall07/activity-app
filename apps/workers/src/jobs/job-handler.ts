import type { JobEnvelope } from '@activity/shared';

export interface JobHandler<TPayload = unknown> {
  readonly type: string;
  /** Must be idempotent: SQS delivers at least once. Throw to retry (then DLQ after maxReceiveCount). */
  handle(job: JobEnvelope<TPayload>): Promise<void>;
}

export const JOB_HANDLERS = Symbol('JOB_HANDLERS');

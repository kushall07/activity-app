import { Injectable } from '@nestjs/common';
import { JOB_TYPES, planIndexPayloadSchema, type JobEnvelope } from '@activity/shared';
import { PlanIndexer } from '../search/plan-indexer.js';
import type { JobHandler } from './job-handler.js';

/** Fast path: the API enqueues this after every plan change. Errors retry via SQS. */
@Injectable()
export class PlanIndexHandler implements JobHandler {
  readonly type = JOB_TYPES.planIndex;

  constructor(private readonly indexer: PlanIndexer) {}

  async handle(job: JobEnvelope): Promise<void> {
    const { planId } = planIndexPayloadSchema.parse(job.payload);
    await this.indexer.sync(planId);
  }
}

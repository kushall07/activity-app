import { Injectable, Logger } from '@nestjs/common';
import { JOB_TYPES, type JobEnvelope } from '@activity/shared';
import type { JobHandler } from './job-handler.js';

/** Smoke-test job: proves the queue -> worker path end to end. */
@Injectable()
export class PingHandler implements JobHandler {
  readonly type = JOB_TYPES.systemPing;
  private readonly logger = new Logger(PingHandler.name);

  async handle(job: JobEnvelope): Promise<void> {
    this.logger.log(`pong for job ${job.id}`);
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { jobEnvelopeSchema } from '@activity/shared';
import { JOB_HANDLERS, type JobHandler } from './job-handler.js';

export type DispatchResult = 'handled' | 'invalid' | 'unknown_type';

@Injectable()
export class JobDispatcher {
  private readonly logger = new Logger(JobDispatcher.name);
  private readonly handlers: Map<string, JobHandler>;

  constructor(@Inject(JOB_HANDLERS) handlers: JobHandler[]) {
    this.handlers = new Map();
    for (const h of handlers) {
      if (this.handlers.has(h.type)) throw new Error(`Duplicate job handler for ${h.type}`);
      this.handlers.set(h.type, h);
    }
  }

  /**
   * Parses and routes a raw message body. Poison messages (bad JSON, unknown type)
   * are reported but not retried; handler errors propagate so SQS redelivers.
   */
  async dispatch(body: string): Promise<DispatchResult> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      this.logger.error('Dropping message with invalid JSON body');
      return 'invalid';
    }
    const result = jobEnvelopeSchema.safeParse(parsed);
    if (!result.success) {
      this.logger.error(`Dropping message with invalid envelope: ${result.error.message}`);
      return 'invalid';
    }
    const handler = this.handlers.get(result.data.type);
    if (!handler) {
      this.logger.error(`No handler for job type ${result.data.type}`);
      return 'unknown_type';
    }
    await handler.handle(result.data);
    return 'handled';
  }
}

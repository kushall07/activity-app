import { Inject, Injectable, Logger } from '@nestjs/common';
import { devices } from '@activity/db';
import { JOB_TYPES, pushSendPayloadSchema, type JobEnvelope } from '@activity/shared';
import { eq, inArray } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../infra/database.js';
import { PUSH_SENDER, type PushSender } from '../push/push-sender.js';
import type { JobHandler } from './job-handler.js';

/**
 * Sends one notification to every device of the listed members.
 *
 * Push is best effort: a failure on one device is logged, not retried, because
 * an SQS retry would re-notify every device that already got it. Dead tokens
 * are removed so we stop paying to send to them.
 */
@Injectable()
export class PushSendHandler implements JobHandler {
  readonly type = JOB_TYPES.pushSend;
  private readonly logger = new Logger(PushSendHandler.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
  ) {}

  async handle(job: JobEnvelope): Promise<void> {
    const p = pushSendPayloadSchema.parse(job.payload);
    const targets = await this.db.select().from(devices).where(inArray(devices.userId, p.userIds));
    for (const d of targets) {
      try {
        const result = await this.sender.send(d, {
          title: p.title,
          body: p.body,
          data: p.data,
          collapseKey: p.collapseKey,
        });
        if (result.status === 'invalid') {
          await this.db.delete(devices).where(eq(devices.id, d.id));
          this.logger.log(`Removed dead push token for ${d.userId}`);
        } else if (result.endpointArn && result.endpointArn !== d.endpointArn) {
          await this.db
            .update(devices)
            .set({ endpointArn: result.endpointArn })
            .where(eq(devices.id, d.id));
        }
      } catch (err) {
        this.logger.warn(`Push to device ${d.id} failed: ${(err as Error).message}`);
      }
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { JOB_TYPES, type PushData, type PushSendPayload } from '@activity/shared';
import { JobsService } from './jobs.service.js';

export interface PushMessage {
  userIds: string[];
  title: string;
  body: string;
  data: PushData;
  collapseKey?: string;
}

/**
 * Push notifications, sent by the workers through SNS. Enqueueing is best
 * effort: a lost push must never fail the request that caused it.
 */
@Injectable()
export class NotifierService {
  private readonly logger = new Logger(NotifierService.name);

  constructor(private readonly jobs: JobsService) {}

  async push(msg: PushMessage): Promise<void> {
    const userIds = [...new Set(msg.userIds)];
    if (userIds.length === 0) return;
    // SNS publishes one endpoint at a time; keep each job small so a retry is cheap.
    for (let i = 0; i < userIds.length; i += 20) {
      const payload: PushSendPayload = {
        userIds: userIds.slice(i, i + 20),
        title: msg.title.slice(0, 100),
        body: msg.body.length > 240 ? `${msg.body.slice(0, 237)}...` : msg.body,
        data: Object.fromEntries(Object.entries(msg.data).map(([k, v]) => [k, String(v)])),
        collapseKey: msg.collapseKey,
      };
      try {
        await this.jobs.enqueue(JOB_TYPES.pushSend, payload);
      } catch (err) {
        this.logger.warn(`Could not enqueue push (${msg.data.kind}): ${(err as Error).message}`);
      }
    }
  }
}

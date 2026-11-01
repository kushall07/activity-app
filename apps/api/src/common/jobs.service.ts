import { randomUUID } from 'node:crypto';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JobEnvelope } from '@activity/shared';
import type { Env } from '../config/env.js';

/** Producer side of the background jobs queue (workers consume it). */
@Injectable()
export class JobsService implements OnApplicationShutdown {
  private readonly sqs: SQSClient;
  private readonly queueUrl: string;

  constructor(config: ConfigService<Env, true>) {
    const endpoint = config.get('SQS_ENDPOINT', { infer: true });
    this.queueUrl = config.get('SQS_JOBS_QUEUE_URL', { infer: true });
    this.sqs = new SQSClient({
      region: config.get('AWS_REGION', { infer: true }),
      ...(endpoint ? { endpoint, credentials: { accessKeyId: 'x', secretAccessKey: 'x' } } : {}),
    });
  }

  /**
   * `id` should be deterministic for the logical job (e.g. `photo.process:<photoId>`)
   * so a retried request does not create distinguishable duplicate work.
   */
  async enqueue<T>(type: string, payload: T, id: string = randomUUID()): Promise<void> {
    const envelope: JobEnvelope<T> = { type, id, createdAt: new Date().toISOString(), payload };
    await this.sqs.send(
      new SendMessageCommand({ QueueUrl: this.queueUrl, MessageBody: JSON.stringify(envelope) }),
    );
  }

  onApplicationShutdown(): void {
    this.sqs.destroy();
  }
}

import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { JobDispatcher } from '../jobs/job-dispatcher.js';

export const SQS_CLIENT = Symbol('SQS_CLIENT');

/**
 * Long-polls the jobs queue and processes messages in parallel batches.
 * A message is deleted only after its handler succeeds (or it is a poison
 * message); failures become visible again and land in the DLQ after
 * maxReceiveCount attempts. On SIGTERM (ECS deploys / scale-in) it stops
 * receiving and drains in-flight work before exiting.
 */
@Injectable()
export class SqsConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SqsConsumer.name);
  private running = false;
  private abort = new AbortController();
  private loop?: Promise<void>;

  private readonly queueUrl: string;
  private readonly batchSize: number;
  private readonly waitSeconds: number;

  constructor(
    @Inject(SQS_CLIENT) private readonly sqs: SQSClient,
    private readonly dispatcher: JobDispatcher,
    config: ConfigService<Env, true>,
  ) {
    this.queueUrl = config.get('SQS_JOBS_QUEUE_URL', { infer: true });
    this.batchSize = config.get('WORKER_CONCURRENCY', { infer: true });
    this.waitSeconds = config.get('SQS_WAIT_SECONDS', { infer: true });
  }

  onApplicationBootstrap(): void {
    this.running = true;
    this.loop = this.run();
    this.logger.log(`Consuming ${this.queueUrl}`);
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`Shutting down (${signal ?? 'no signal'}), draining in-flight jobs`);
    this.running = false;
    this.abort.abort();
    await this.loop;
    this.sqs.destroy();
  }

  private async run(): Promise<void> {
    let backoffMs = 1_000;
    while (this.running) {
      try {
        const messages = await this.receive();
        backoffMs = 1_000;
        if (messages.length) await Promise.all(messages.map((m) => this.process(m)));
      } catch (err) {
        if (!this.running) break;
        this.logger.error(`Receive failed: ${(err as Error).message}; retrying in ${backoffMs}ms`);
        await new Promise((r) => setTimeout(r, backoffMs));
        backoffMs = Math.min(backoffMs * 2, 30_000);
      }
    }
  }

  private async receive(): Promise<Message[]> {
    const res = await this.sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: this.batchSize,
        WaitTimeSeconds: this.waitSeconds,
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      }),
      { abortSignal: this.abort.signal },
    );
    return res.Messages ?? [];
  }

  /** Exposed for tests. */
  async process(message: Message): Promise<void> {
    try {
      await this.dispatcher.dispatch(message.Body ?? '');
      await this.sqs.send(
        new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: message.ReceiptHandle }),
      );
    } catch (err) {
      const attempts = message.Attributes?.ApproximateReceiveCount ?? '?';
      this.logger.error(
        `Job ${message.MessageId} failed (attempt ${attempts}): ${(err as Error).message}`,
      );
    }
  }
}

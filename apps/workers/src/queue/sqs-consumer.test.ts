import { DeleteMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.js';
import type { JobDispatcher } from '../jobs/job-dispatcher.js';
import { SqsConsumer } from './sqs-consumer.js';

const config = {
  get: (key: string) =>
    ({ SQS_JOBS_QUEUE_URL: 'http://q/jobs', WORKER_CONCURRENCY: 10, SQS_WAIT_SECONDS: 0 })[key],
} as unknown as ConfigService<Env, true>;

function setup(dispatch: () => Promise<unknown>) {
  const send = vi.fn(async (_cmd: unknown) => ({}));
  const sqs = { send, destroy: vi.fn() } as unknown as SQSClient;
  const dispatcher = { dispatch: vi.fn(dispatch) } as unknown as JobDispatcher;
  return { send, consumer: new SqsConsumer(sqs, dispatcher, config) };
}

describe('SqsConsumer.process', () => {
  it('deletes the message after the handler succeeds', async () => {
    const { send, consumer } = setup(async () => 'handled');
    await consumer.process({ MessageId: 'm1', ReceiptHandle: 'rh1', Body: '{}' });
    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0]![0] as DeleteMessageCommand;
    expect(cmd).toBeInstanceOf(DeleteMessageCommand);
    expect(cmd.input).toEqual({ QueueUrl: 'http://q/jobs', ReceiptHandle: 'rh1' });
  });

  it('leaves the message on the queue when the handler throws', async () => {
    const { send, consumer } = setup(async () => {
      throw new Error('downstream unavailable');
    });
    await consumer.process({ MessageId: 'm2', ReceiptHandle: 'rh2', Body: '{}' });
    expect(send).not.toHaveBeenCalled();
  });
});

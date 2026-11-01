import { SQSClient } from '@aws-sdk/client-sqs';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { Env, validateEnv } from './config/env.js';
import { JobDispatcher } from './jobs/job-dispatcher.js';
import { JOB_HANDLERS, type JobHandler } from './jobs/job-handler.js';
import { PingHandler } from './jobs/ping.handler.js';
import { SQS_CLIENT, SqsConsumer } from './queue/sqs-consumer.js';

/** Register new job handlers here. */
const HANDLERS = [PingHandler];

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          transport:
            config.get('NODE_ENV', { infer: true }) === 'production'
              ? undefined
              : { target: 'pino-pretty', options: { singleLine: true } },
        },
      }),
    }),
  ],
  providers: [
    ...HANDLERS,
    {
      provide: JOB_HANDLERS,
      inject: HANDLERS,
      useFactory: (...handlers: JobHandler[]) => handlers,
    },
    {
      provide: SQS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const endpoint = config.get('SQS_ENDPOINT', { infer: true });
        return new SQSClient({
          region: config.get('AWS_REGION', { infer: true }),
          // Local ElasticMQ accepts any credentials; in AWS the task role is used.
          ...(endpoint
            ? { endpoint, credentials: { accessKeyId: 'x', secretAccessKey: 'x' } }
            : {}),
        });
      },
    },
    JobDispatcher,
    SqsConsumer,
  ],
})
export class WorkerModule {}

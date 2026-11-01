import { RekognitionClient } from '@aws-sdk/client-rekognition';
import { SNSClient } from '@aws-sdk/client-sns';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { Env, validateEnv } from './config/env.js';
import { JobDispatcher } from './jobs/job-dispatcher.js';
import { JOB_HANDLERS, type JobHandler } from './jobs/job-handler.js';
import { PhotoProcessHandler } from './jobs/photo-process.handler.js';
import { PingHandler } from './jobs/ping.handler.js';
import { SelfieVerifyHandler } from './jobs/selfie-verify.handler.js';
import { PlanIndexHandler } from './jobs/plan-index.handler.js';
import { PushSendHandler } from './jobs/push-send.handler.js';
import { LogPushSender, PUSH_SENDER, SnsPushSender } from './push/push-sender.js';
import { RequestExpirySweeper } from './requests/request-expiry-sweeper.js';
import { UserPurgeHandler } from './jobs/user-purge.handler.js';
import { createDb, createPool, DRIZZLE, PG_POOL } from './infra/database.js';
import { OBJECT_STORE, S3ObjectStore } from './infra/object-store.js';
import { MODERATION, NoopModeration, RekognitionModeration } from './media/moderation.js';
import type pg from 'pg';
import { SQS_CLIENT, SqsConsumer } from './queue/sqs-consumer.js';
import { createSearchClient } from '@activity/search';
import { PlanIndexSweeper } from './search/plan-index-sweeper.js';
import { PlanIndexer, SEARCH_CLIENT, SEARCH_REPLICAS } from './search/plan-indexer.js';

/** Register new job handlers here. */
const HANDLERS = [
  PingHandler,
  PhotoProcessHandler,
  SelfieVerifyHandler,
  UserPurgeHandler,
  PlanIndexHandler,
  PushSendHandler,
];

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
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createPool({
          DATABASE_URL: config.get('DATABASE_URL', { infer: true }),
          DATABASE_POOL_MAX: config.get('DATABASE_POOL_MAX', { infer: true }),
          DATABASE_SSL: config.get('DATABASE_SSL', { infer: true }),
        }),
    },
    { provide: DRIZZLE, inject: [PG_POOL], useFactory: createDb },
    {
      provide: OBJECT_STORE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const endpoint = config.get('S3_ENDPOINT', { infer: true });
        const s3 = new S3Client({
          region: config.get('AWS_REGION', { infer: true }),
          ...(endpoint
            ? {
                endpoint,
                forcePathStyle: true,
                credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
              }
            : {}),
        });
        return new S3ObjectStore(s3, config.get('PHOTOS_BUCKET', { infer: true }));
      },
    },
    {
      provide: MODERATION,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('MODERATION_PROVIDER', { infer: true }) === 'rekognition'
          ? new RekognitionModeration(
              new RekognitionClient({ region: config.get('AWS_REGION', { infer: true }) }),
              config.get('MODERATION_MIN_CONFIDENCE', { infer: true }),
            )
          : new NoopModeration(),
    },
    {
      provide: SEARCH_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('SEARCH_PROVIDER', { infer: true }) === 'opensearch'
          ? createSearchClient({
              node: config.get('OPENSEARCH_URL', { infer: true })!,
              auth: config.get('OPENSEARCH_AUTH', { infer: true }),
              region: config.get('AWS_REGION', { infer: true }),
              requestTimeoutMs: 10_000,
            })
          : null,
    },
    {
      provide: SEARCH_REPLICAS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('OPENSEARCH_REPLICAS', { infer: true }),
    },
    {
      provide: PUSH_SENDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('PUSH_PROVIDER', { infer: true }) === 'sns'
          ? new SnsPushSender(
              new SNSClient({ region: config.get('AWS_REGION', { infer: true }) }),
              {
                android: config.get('SNS_ANDROID_APP_ARN', { infer: true }),
                ios: config.get('SNS_IOS_APP_ARN', { infer: true }),
              },
              config.get('SNS_APNS_PLATFORM', { infer: true }),
            )
          : new LogPushSender(),
    },
    PlanIndexer,
    PlanIndexSweeper,
    RequestExpirySweeper,
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
export class WorkerModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown(): Promise<void> {
    // Runs after SqsConsumer has drained in-flight jobs.
    await this.pool.end();
  }
}

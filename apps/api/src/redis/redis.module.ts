import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../config/env.js';
import { REDIS } from './redis.constants.js';

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: async (config: ConfigService<Env, true>) => {
        const client = new Redis(config.get('REDIS_URL', { infer: true }), {
          maxRetriesPerRequest: 2,
          enableOfflineQueue: false,
          connectionName: 'activity-api',
        });
        const logger = new Logger('Redis');
        client.on('error', (err: Error) => logger.warn(`Redis error: ${err.message}`));
        // With the offline queue off, commands sent before the first connect fail. Give the
        // connection a moment at boot, but still start (degraded) if Redis is down.
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 5_000);
          client.once('ready', () => {
            clearTimeout(timer);
            resolve();
          });
        });
        return client;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}

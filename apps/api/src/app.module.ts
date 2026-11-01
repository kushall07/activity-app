import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module.js';
import { CommonModule } from './common/common.module.js';
import { Env, validateEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { ProfilesModule } from './profiles/profiles.module.js';
import { RedisModule } from './redis/redis.module.js';

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
      useFactory: (config: ConfigService<Env, true>) => {
        const isProd = config.get('NODE_ENV', { infer: true }) === 'production';
        return {
          pinoHttp: {
            level: config.get('LOG_LEVEL', { infer: true }),
            // JSON logs in AWS (CloudWatch parses them); pretty logs locally.
            transport: isProd
              ? undefined
              : { target: 'pino-pretty', options: { singleLine: true } },
            genReqId: (req, res) => {
              const incoming = req.headers['x-request-id'];
              const id = typeof incoming === 'string' && incoming ? incoming : randomUUID();
              res.setHeader('x-request-id', id);
              return id;
            },
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            // Never log request bodies: they carry OTPs and refresh tokens.
            autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
          },
        };
      },
    }),
    DatabaseModule,
    RedisModule,
    CommonModule,
    HealthModule,
    AuthModule,
    ProfilesModule,
  ],
})
export class AppModule {}

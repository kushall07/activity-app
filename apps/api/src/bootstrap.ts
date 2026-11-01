import { INestApplication, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { Env } from './config/env.js';

/** Shared app setup so production and e2e tests run the exact same middleware stack. */
export function configureApp(app: NestExpressApplication): INestApplication {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  if (config.get('TRUST_PROXY', { infer: true })) {
    // Behind the ALB: honour X-Forwarded-* for client IPs and protocol.
    app.set('trust proxy', 1);
  }
  app.use(helmet());
  const origins = config
    .get('CORS_ORIGINS', { infer: true })
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins.length ? origins : false });

  // Feature routes live under /v1/...; health stays unversioned for load balancers.
  app.setGlobalPrefix('v1', {
    exclude: [
      { path: 'health', method: RequestMethod.ALL },
      { path: 'health/{*path}', method: RequestMethod.ALL },
    ],
  });
  app.enableShutdownHooks();
  return app;
}

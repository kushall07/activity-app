import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createSearchClient, type SearchClient } from '@activity/search';
import type { Env } from '../config/env.js';

/** OpenSearch client, or null when SEARCH_PROVIDER=postgres. */
export const SEARCH_CLIENT = Symbol('SEARCH_CLIENT');
export type MaybeSearchClient = SearchClient | null;

@Global()
@Module({
  providers: [
    {
      provide: SEARCH_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): MaybeSearchClient => {
        if (config.get('SEARCH_PROVIDER', { infer: true }) !== 'opensearch') return null;
        return createSearchClient({
          node: config.get('OPENSEARCH_URL', { infer: true })!,
          auth: config.get('OPENSEARCH_AUTH', { infer: true }),
          region: config.get('AWS_REGION', { infer: true }),
          requestTimeoutMs: config.get('OPENSEARCH_TIMEOUT_MS', { infer: true }),
        });
      },
    },
  ],
  exports: [SEARCH_CLIENT],
})
export class SearchModule {}

import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { Client, errors } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws-v3';

export type SearchClient = Client;

export interface SearchClientOptions {
  /** Domain endpoint, e.g. https://vpc-activity-prod-plans-xxxx.ap-south-1.es.amazonaws.com */
  node: string;
  /** `aws` signs requests with the task role (SigV4). `none` is for local OpenSearch only. */
  auth: 'aws' | 'none';
  region: string;
  /** Per-request timeout. The feed falls back to Postgres when search is slow. */
  requestTimeoutMs?: number;
}

export function createSearchClient(opts: SearchClientOptions): SearchClient {
  const base = {
    node: opts.node,
    requestTimeout: opts.requestTimeoutMs ?? 2_000,
    maxRetries: 1,
    compression: 'gzip' as const,
  };
  if (opts.auth === 'none') return new Client(base);
  const credentials = defaultProvider();
  return new Client({
    ...base,
    ...AwsSigv4Signer({ region: opts.region, service: 'es', getCredentials: () => credentials() }),
  });
}

export function statusOf(err: unknown): number | undefined {
  return err instanceof errors.ResponseError ? err.statusCode : undefined;
}

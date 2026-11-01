import { healthResponseSchema, type HealthResponse } from '@activity/shared';
import type { z } from 'zod';
import { config } from './config';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type FetchLike = typeof fetch;

/**
 * Minimal typed client. Every response is validated against the shared
 * contract so API/mobile drift fails loudly instead of rendering garbage.
 */
export function createApiClient(baseUrl = config.apiUrl, fetchImpl: FetchLike = fetch) {
  async function get<T>(path: string, schema: z.ZodType<T>, opts: { allowStatus?: number[] } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (err) {
      const reason = controller.signal.aborted ? 'timed out' : (err as Error).message;
      throw new ApiError(`Could not reach API at ${baseUrl} (${reason})`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok && !opts.allowStatus?.includes(res.status)) {
      throw new ApiError(`API responded ${res.status}`, res.status);
    }
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) throw new ApiError('Unexpected response shape from API', res.status);
    return parsed.data;
  }

  return {
    baseUrl,
    /** Readiness returns 503 with the same body when a dependency is down; still render it. */
    health: (): Promise<HealthResponse> =>
      get('/health/ready', healthResponseSchema, { allowStatus: [503] }),
  };
}

export const api = createApiClient();

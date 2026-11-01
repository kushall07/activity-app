import {
  apiErrorSchema,
  authTokensSchema,
  createPhotoUploadResponseSchema,
  createSelfieUploadResponseSchema,
  healthResponseSchema,
  meResponseSchema,
  photoSchema,
  photosResponseSchema,
  profileSchema,
  startOtpResponseSchema,
  verificationResponseSchema,
  verifyOtpResponseSchema,
  type CreateUploadRequest,
  type HealthResponse,
  type UpsertProfileRequest,
} from '@activity/shared';
import { z } from 'zod';
import { config } from './config';
import type { Session } from './session';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** Stable machine-readable code from the API, e.g. `otp_invalid_code`. */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type FetchLike = typeof fetch;
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface RequestOptions<T> {
  body?: unknown;
  schema?: z.ZodType<T>;
  /** Send the access token (and refresh it once on 401). */
  auth?: boolean;
  allowStatus?: number[];
}

const empty = z.unknown();

/**
 * Typed API client. Every response is validated against the shared contract so
 * API/mobile drift fails loudly instead of rendering garbage. Authenticated calls
 * refresh the access token transparently (one refresh in flight at a time).
 */
export function createApiClient(
  baseUrl = config.apiUrl,
  fetchImpl: FetchLike = fetch,
  session?: Session,
) {
  let refreshing: Promise<boolean> | null = null;

  async function send(method: Method, path: string, body: unknown, token?: string | null) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
      return await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      const reason = controller.signal.aborted ? 'timed out' : (err as Error).message;
      throw new ApiError(`Could not reach the server (${reason})`);
    } finally {
      clearTimeout(timer);
    }
  }

  async function refresh(): Promise<boolean> {
    const refreshToken = session?.getRefreshToken();
    if (!session || !refreshToken) return false;
    refreshing ??= (async () => {
      try {
        const res = await send('POST', '/v1/auth/refresh', { refreshToken });
        if (!res.ok) {
          if (res.status === 401) await session.signOut();
          return false;
        }
        await session.update(authTokensSchema.parse(await res.json()));
        return true;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function request<T = unknown>(
    method: Method,
    path: string,
    opts: RequestOptions<T> = {},
  ): Promise<T> {
    if (opts.auth && session && !session.getAccessToken()) await refresh();
    let res = await send(method, path, opts.body, opts.auth ? session?.getAccessToken() : null);
    if (res.status === 401 && opts.auth && (await refresh())) {
      res = await send(method, path, opts.body, session?.getAccessToken());
    }

    if (!res.ok && !opts.allowStatus?.includes(res.status)) {
      let parsedError: z.infer<typeof apiErrorSchema> | undefined;
      try {
        parsedError = apiErrorSchema.parse(await res.json());
      } catch {
        parsedError = undefined;
      }
      throw new ApiError(
        parsedError?.message ?? `Something went wrong (${res.status})`,
        res.status,
        parsedError?.code,
      );
    }
    if (res.status === 204) return undefined as T;
    const json: unknown = await res.json();
    const parsed = (opts.schema ?? empty).safeParse(json);
    if (!parsed.success) throw new ApiError('Unexpected response from the server', res.status);
    return parsed.data as T;
  }

  const authed = { auth: true } as const;

  return {
    baseUrl,
    /** Readiness returns 503 with the same body when a dependency is down; still render it. */
    health: (): Promise<HealthResponse> =>
      request('GET', '/health/ready', { schema: healthResponseSchema, allowStatus: [503] }),

    startOtp: (phone: string) =>
      request('POST', '/v1/auth/otp/start', { body: { phone }, schema: startOtpResponseSchema }),
    verifyOtp: (challengeId: string, code: string) =>
      request('POST', '/v1/auth/otp/verify', {
        body: { challengeId, code },
        schema: verifyOtpResponseSchema,
      }),
    logout: (refreshToken: string) =>
      request<void>('POST', '/v1/auth/logout', { body: { refreshToken } }),
    deleteAccount: () => request<void>('DELETE', '/v1/me', authed),

    me: () => request('GET', '/v1/me', { ...authed, schema: meResponseSchema }),
    saveProfile: (profile: UpsertProfileRequest) =>
      request('PUT', '/v1/me/profile', { ...authed, body: profile, schema: profileSchema }),

    createPhotoUpload: (req: CreateUploadRequest) =>
      request('POST', '/v1/me/photos', {
        ...authed,
        body: req,
        schema: createPhotoUploadResponseSchema,
      }),
    completePhoto: (id: string) =>
      request('POST', `/v1/me/photos/${id}/complete`, { ...authed, schema: photoSchema }),
    reorderPhotos: (photoIds: string[]) =>
      request('PUT', '/v1/me/photos/order', {
        ...authed,
        body: { photoIds },
        schema: photosResponseSchema,
      }),
    deletePhoto: (id: string) =>
      request('DELETE', `/v1/me/photos/${id}`, { ...authed, schema: photosResponseSchema }),

    createSelfieUpload: () =>
      request('POST', '/v1/me/verification/selfie', {
        ...authed,
        schema: createSelfieUploadResponseSchema,
      }),
    completeSelfie: (id: string) =>
      request('POST', `/v1/me/verification/selfie/${id}/complete`, {
        ...authed,
        schema: verificationResponseSchema,
      }),
    getSelfie: (id: string) =>
      request('GET', `/v1/me/verification/selfie/${id}`, {
        ...authed,
        schema: verificationResponseSchema,
      }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

import {
  activitiesResponseSchema,
  apiErrorSchema,
  chatsResponseSchema,
  chatSummarySchema,
  messageSchema,
  messagesResponseSchema,
  myRequestsResponseSchema,
  planRequestsResponseSchema,
  requestDecisionResponseSchema,
  authTokensSchema,
  createPhotoUploadResponseSchema,
  createSelfieUploadResponseSchema,
  feedResponseSchema,
  healthResponseSchema,
  meResponseSchema,
  myPlansResponseSchema,
  photoSchema,
  photosResponseSchema,
  planSchema,
  profileSchema,
  startOtpResponseSchema,
  verificationResponseSchema,
  venuesResponseSchema,
  verifyOtpResponseSchema,
  type CreatePlanRequest,
  type CreateRequest,
  type RegisterDevice,
  type CreateUploadRequest,
  type HealthResponse,
  type UpdatePlanRequest,
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
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions<T> {
  body?: unknown;
  schema?: z.ZodType<T>;
  /** Send the access token (and refresh it once on 401). */
  auth?: boolean;
  allowStatus?: number[];
}

const empty = z.unknown();

/** Query string from defined values; arrays become comma-separated lists. */
export function toQuery(params: Record<string, string | number | string[] | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))
    .map(
      ([k, v]) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(Array.isArray(v) ? v.join(',') : String(v))}`,
    );
  return parts.length ? `?${parts.join('&')}` : '';
}

export interface FeedParams {
  lat: number;
  lng: number;
  radiusKm?: number;
  categories?: string[];
  activities?: string[];
  from?: string;
  to?: string;
  intent?: 'date' | 'friends' | 'either';
  maxCostInr?: number;
  sort?: 'soonest' | 'nearest';
  limit?: number;
  cursor?: string;
}

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
    /** A usable access token for the chat socket; `force` refreshes even if one is cached. */
    accessToken: async (force = false): Promise<string | null> => {
      if (force || !session?.getAccessToken()) await refresh();
      return session?.getAccessToken() ?? null;
    },
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

    activities: () =>
      request('GET', '/v1/activities', { ...authed, schema: activitiesResponseSchema }),
    venues: (params: { q?: string; activity?: string; lat?: number; lng?: number }) =>
      request('GET', `/v1/venues${toQuery(params)}`, { ...authed, schema: venuesResponseSchema }),
    feed: (params: FeedParams) =>
      request('GET', `/v1/plans${toQuery({ ...params })}`, {
        ...authed,
        schema: feedResponseSchema,
      }),
    plan: (id: string, origin?: { lat: number; lng: number }) =>
      request('GET', `/v1/plans/${id}${toQuery({ ...origin })}`, { ...authed, schema: planSchema }),
    createPlan: (plan: CreatePlanRequest) =>
      request('POST', '/v1/plans', { ...authed, body: plan, schema: planSchema }),
    updatePlan: (id: string, patch: UpdatePlanRequest) =>
      request('PATCH', `/v1/plans/${id}`, { ...authed, body: patch, schema: planSchema }),
    cancelPlan: (id: string) =>
      request('POST', `/v1/plans/${id}/cancel`, { ...authed, schema: planSchema }),
    myPlans: (scope: 'upcoming' | 'past') =>
      request('GET', `/v1/me/plans?scope=${scope}`, { ...authed, schema: myPlansResponseSchema }),

    // --- Requests ("I'm in") ---
    requestToJoin: (planId: string, body: CreateRequest) =>
      request('POST', `/v1/plans/${planId}/requests`, {
        ...authed,
        body,
        schema: requestDecisionResponseSchema,
      }),
    planRequests: (planId: string) =>
      request('GET', `/v1/plans/${planId}/requests`, {
        ...authed,
        schema: planRequestsResponseSchema,
      }),
    decideRequest: (requestId: string, action: 'accept' | 'decline' | 'withdraw') =>
      request('POST', `/v1/requests/${requestId}/${action}`, {
        ...authed,
        schema: requestDecisionResponseSchema,
      }),
    myRequests: () =>
      request('GET', '/v1/me/requests', { ...authed, schema: myRequestsResponseSchema }),

    // --- Chat (REST; live updates come over the socket) ---
    chats: () => request('GET', '/v1/chats', { ...authed, schema: chatsResponseSchema }),
    chat: (id: string) =>
      request('GET', `/v1/chats/${id}`, { ...authed, schema: chatSummarySchema }),
    messages: (id: string, params: { before?: number; after?: number; limit?: number } = {}) =>
      request('GET', `/v1/chats/${id}/messages${toQuery(params)}`, {
        ...authed,
        schema: messagesResponseSchema,
      }),
    sendMessage: (id: string, body: { clientId: string; body: string }) =>
      request('POST', `/v1/chats/${id}/messages`, { ...authed, body, schema: messageSchema }),
    markRead: (id: string, messageId: number) =>
      request<void>('POST', `/v1/chats/${id}/read`, { ...authed, body: { messageId } }),

    // --- Push ---
    registerDevice: (device: RegisterDevice) =>
      request<void>('PUT', '/v1/me/devices', { ...authed, body: device }),
    removeDevice: (device: RegisterDevice) =>
      request<void>('POST', '/v1/me/devices/remove', { ...authed, body: device }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

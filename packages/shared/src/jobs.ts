import { z } from 'zod';

/**
 * Envelope for every message on the background jobs queue (SQS).
 * Producers (API) and consumers (workers) both validate against this.
 */
export const jobEnvelopeSchema = z.object({
  /** Discriminator used by workers to route to a handler, e.g. `system.ping`. */
  type: z.string().min(1),
  /** Unique per logical job; handlers must be idempotent on this id (SQS is at-least-once). */
  id: z.string().min(1),
  createdAt: z.string(),
  payload: z.unknown(),
});

export type JobEnvelope<TPayload = unknown> = Omit<z.infer<typeof jobEnvelopeSchema>, 'payload'> & {
  payload: TPayload;
};

export const JOB_TYPES = {
  systemPing: 'system.ping',
  /** Validate, strip EXIF, resize and moderate an uploaded profile photo. */
  photoProcess: 'photo.process',
  /** Compare a verification selfie with the user's approved photos. */
  selfieVerify: 'selfie.verify',
  /** Delete every stored object for a deleted account. */
  userPurge: 'user.purge',
} as const;

export const photoProcessPayloadSchema = z.object({ photoId: z.string().uuid() });
export const selfieVerifyPayloadSchema = z.object({ verificationId: z.string().uuid() });
export const userPurgePayloadSchema = z.object({ userId: z.string().uuid() });

export type PhotoProcessPayload = z.infer<typeof photoProcessPayloadSchema>;
export type SelfieVerifyPayload = z.infer<typeof selfieVerifyPayloadSchema>;
export type UserPurgePayload = z.infer<typeof userPurgePayloadSchema>;

/**
 * S3 key layout, shared so the API (presigns) and workers (process) agree.
 * Only `public/` is readable through CloudFront; everything else stays private.
 */
export const storageKeys = {
  photoUpload: (userId: string, photoId: string) => `incoming/${userId}/${photoId}`,
  photoPublicPrefix: (userId: string, photoId: string) => `public/photos/${userId}/${photoId}`,
  photoVariant: (prefix: string, variant: 'full' | 'thumb') => `${prefix}/${variant}.jpg`,
  selfieUpload: (userId: string, verificationId: string) =>
    `verification/${userId}/${verificationId}`,
  userPrefixes: (userId: string) => [
    `incoming/${userId}/`,
    `public/photos/${userId}/`,
    `verification/${userId}/`,
  ],
};

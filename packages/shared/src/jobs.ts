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
} as const;

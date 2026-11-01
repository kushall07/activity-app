import { z } from 'zod';
import { activitySchema, planSchema, requestStatusSchema, skillLevelSchema } from './plans.js';
import { genderSchema } from './profile.js';

export const REQUEST_RULES = {
  /** "I'm in" requests a member can send per day (free tier). */
  maxPerDay: 5,
  /** A request waits this long for the host, or until the plan starts if sooner. */
  ttlHours: 24,
  /** Fairness cap: pending requests one plan can hold, so popular hosts are not flooded. */
  maxPendingPerPlan: 20,
  messageMaxLength: 200,
  /** Members who joined recently get a small boost in request stacks. */
  newMemberDays: 14,
} as const;

/** Starting weights from the plan doc. "Past chemistry" (10%) arrives with ratings. */
export const SCORE_WEIGHTS = {
  distance: 25,
  activityFit: 20,
  trust: 20,
  intent: 15,
  freshness: 10,
} as const;

export const createRequestSchema = z.object({
  message: z.string().trim().max(REQUEST_RULES.messageMaxLength).default(''),
  /** The requester's level for this activity; asked when the plan sets a level. */
  skillLevel: skillLevelSchema.exclude(['any']).optional(),
});

/** Who is asking to join: enough for the host to decide, nothing more (no phone, no birthday). */
export const requesterSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  age: z.number().int(),
  gender: genderSchema,
  verified: z.boolean(),
  neighbourhood: z.string().nullable(),
  bio: z.string(),
  jobTitle: z.string().nullable(),
  interests: z.array(z.string()),
  photoUrls: z.array(z.string().url()),
});

export const planRequestSchema = z.object({
  id: z.string().uuid(),
  planId: z.string().uuid(),
  status: requestStatusSchema,
  message: z.string(),
  skillLevel: skillLevelSchema.nullable(),
  score: z.number().int(),
  /** Short reasons the host sees, e.g. "Both intermediate", "3 km away". */
  reasons: z.array(z.string()),
  expiresAt: z.string(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  requester: requesterSchema,
});

/** The host's view of one plan: who is waiting, best match first, and who is in. */
export const planRequestsResponseSchema = z.object({
  pending: z.array(planRequestSchema),
  accepted: z.array(planRequestSchema),
});

/** What the requester sees about their own request. */
export const myRequestSchema = z.object({
  id: z.string().uuid(),
  status: requestStatusSchema,
  message: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
  chatId: z.string().uuid().nullable(),
  plan: z.object({
    id: z.string().uuid(),
    activity: activitySchema,
    startsAt: z.string(),
    placeName: z.string(),
    area: z.string(),
    hostName: z.string(),
    hostPhotoUrl: z.string().url().nullable(),
  }),
});
export const myRequestsResponseSchema = z.object({ requests: z.array(myRequestSchema) });

export const requestDecisionResponseSchema = z.object({
  request: z.object({ id: z.string().uuid(), status: requestStatusSchema }),
  /** Null only when a member who left can no longer see the plan. */
  plan: planSchema.nullable(),
});

export const blockRequestSchema = z.object({ userId: z.string().uuid() });

export type CreateRequest = z.input<typeof createRequestSchema>;
export type Requester = z.infer<typeof requesterSchema>;
export type PlanRequest = z.infer<typeof planRequestSchema>;
export type PlanRequestsResponse = z.infer<typeof planRequestsResponseSchema>;
export type MyRequest = z.infer<typeof myRequestSchema>;
export type MyRequestsResponse = z.infer<typeof myRequestsResponseSchema>;
export type RequestDecisionResponse = z.infer<typeof requestDecisionResponseSchema>;

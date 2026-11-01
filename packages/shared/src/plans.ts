import { z } from 'zod';
import { genderSchema, intentSchema, PROFILE_RULES } from './profile.js';

export const PLAN_RULES = {
  /** Open seats a host can offer, not counting themselves. */
  minSeats: 1,
  maxSeats: 10,
  minDurationMinutes: 30,
  maxDurationMinutes: 12 * 60,
  /** A plan must start at least this far ahead, so people have time to respond. */
  minLeadMinutes: 30,
  /** And no further out than this. */
  maxLeadDays: 60,
  noteMaxLength: 300,
  placeNameMaxLength: 80,
  maxCostPerPersonInr: 50_000,
  /** Upcoming open plans one host can have at once. */
  maxActivePlansPerHost: 5,
  /** New plans per host per day (abuse control). */
  maxPlansPerDay: 10,
  defaultRadiusKm: 10,
  maxRadiusKm: 50,
  defaultPageSize: 20,
  maxPageSize: 50,
} as const;

/** The launch city. Plans outside this box are refused. */
export const BENGALURU_BOUNDS = {
  minLat: 12.7,
  maxLat: 13.25,
  minLng: 77.3,
  maxLng: 77.9,
} as const;

export const ACTIVITY_CATEGORIES = [
  'sport',
  'show',
  'workshop',
  'food',
  'outdoors',
  'art',
  'science',
  'games',
] as const;
export const SKILL_LEVELS = ['any', 'beginner', 'intermediate', 'advanced'] as const;
/** Who pays: the host, split equally, each pays their own, or nothing to pay. */
export const COST_SPLITS = ['free', 'host_pays', 'split_equally', 'each_pays_own'] as const;
export const PLAN_STATUSES = ['open', 'full', 'cancelled', 'completed'] as const;
export const FEED_SORTS = ['soonest', 'nearest'] as const;
export const REQUEST_STATUSES = [
  'pending',
  'accepted',
  'declined',
  'withdrawn',
  'expired',
  'cancelled',
] as const;

export const activityCategorySchema = z.enum(ACTIVITY_CATEGORIES);
export const skillLevelSchema = z.enum(SKILL_LEVELS);
export const costSplitSchema = z.enum(COST_SPLITS);
export const planStatusSchema = z.enum(PLAN_STATUSES);
export const feedSortSchema = z.enum(FEED_SORTS);
export const requestStatusSchema = z.enum(REQUEST_STATUSES);

/**
 * Bengaluru neighbourhoods with approximate centre points. Used for custom
 * places (we never ask for an exact address) and as a fallback location for
 * the feed when the member has not shared their location.
 */
export const BENGALURU_AREAS = [
  { name: 'Koramangala', lat: 12.9352, lng: 77.6245 },
  { name: 'Indiranagar', lat: 12.9719, lng: 77.6412 },
  { name: 'HSR Layout', lat: 12.9116, lng: 77.6474 },
  { name: 'MG Road', lat: 12.9756, lng: 77.605 },
  { name: 'Whitefield', lat: 12.9698, lng: 77.75 },
  { name: 'Jayanagar', lat: 12.925, lng: 77.5938 },
  { name: 'JP Nagar', lat: 12.9063, lng: 77.5857 },
  { name: 'BTM Layout', lat: 12.9166, lng: 77.6101 },
  { name: 'Bellandur', lat: 12.9304, lng: 77.6784 },
  { name: 'Sarjapur Road', lat: 12.91, lng: 77.687 },
  { name: 'Marathahalli', lat: 12.9569, lng: 77.7011 },
  { name: 'Electronic City', lat: 12.8452, lng: 77.6602 },
  { name: 'Malleshwaram', lat: 13.0031, lng: 77.5643 },
  { name: 'Rajajinagar', lat: 12.991, lng: 77.553 },
  { name: 'Basavanagudi', lat: 12.9406, lng: 77.5738 },
  { name: 'Banashankari', lat: 12.9255, lng: 77.5468 },
  { name: 'Hebbal', lat: 13.0358, lng: 77.597 },
  { name: 'Yelahanka', lat: 13.1007, lng: 77.5963 },
  { name: 'Frazer Town', lat: 12.998, lng: 77.615 },
  { name: 'Sadashivanagar', lat: 13.0068, lng: 77.5813 },
] as const;

export const AREA_NAMES = BENGALURU_AREAS.map((a) => a.name) as unknown as readonly [
  string,
  ...string[],
];

export const latLngSchema = z
  .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
  .refine(
    ({ lat, lng }) =>
      lat >= BENGALURU_BOUNDS.minLat &&
      lat <= BENGALURU_BOUNDS.maxLat &&
      lng >= BENGALURU_BOUNDS.minLng &&
      lng <= BENGALURU_BOUNDS.maxLng,
    'We only support plans in Bengaluru for now',
  );

const PHONE_LIKE = /(?:\+?91[\s-]?)?[6-9](?:[\s-]?\d){9}/;
const EMAIL_LIKE = /[\w.+-]+@[\w-]+\.[\w.]+/;
const HANDLE_LIKE = /(?:^|\s)@[a-z0-9._]{3,}/i;

/**
 * Phone numbers, emails and social handles are kept out of public plan text:
 * contact happens in the app's chat after a match, which keeps people safe.
 */
export function containsContactDetails(text: string): boolean {
  return PHONE_LIKE.test(text) || EMAIL_LIKE.test(text) || HANDLE_LIKE.test(text);
}

const publicText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((s) => !containsContactDetails(s), {
      message: 'Leave out phone numbers, emails and handles; you can chat once matched',
    });

export const activitySchema = z.object({
  slug: z.string(),
  name: z.string(),
  category: activityCategorySchema,
  emoji: z.string(),
  defaultSeats: z.number().int(),
});
export const activitiesResponseSchema = z.object({ activities: z.array(activitySchema) });

export const venueSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  area: z.string().nullable(),
  address: z.string().nullable(),
  lat: z.number(),
  lng: z.number(),
  activities: z.array(z.string()),
  distanceKm: z.number().nullable(),
});
export const venuesResponseSchema = z.object({ venues: z.array(venueSchema) });

export const venueSearchQuerySchema = z.object({
  q: z.string().trim().max(60).optional(),
  activity: z.string().max(40).optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** A place that is not a listed venue: a name and a neighbourhood, never an address. */
export const customPlaceSchema = z
  .object({
    name: publicText(PLAN_RULES.placeNameMaxLength).pipe(z.string().min(2, 'Name the place')),
    area: z.enum(AREA_NAMES),
    /** Optional pin; defaults to the neighbourhood's centre. */
    lat: z.number().optional(),
    lng: z.number().optional(),
  })
  .superRefine((p, ctx) => {
    if ((p.lat === undefined) !== (p.lng === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['lat'], message: 'Send both lat and lng, or neither' });
    } else if (p.lat !== undefined && !latLngSchema.safeParse({ lat: p.lat, lng: p.lng }).success) {
      ctx.addIssue({
        code: 'custom',
        path: ['lat'],
        message: 'We only support plans in Bengaluru for now',
      });
    }
  });

const genderMixSchema = z
  .object({
    woman: z.number().int().min(0),
    man: z.number().int().min(0),
    nonbinary: z.number().int().min(0),
  })
  .partial();

const planFields = {
  activitySlug: z.string().min(1).max(40),
  venueId: z.string().uuid().nullable().optional(),
  place: customPlaceSchema.nullable().optional(),
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: z
    .number()
    .int()
    .min(PLAN_RULES.minDurationMinutes)
    .max(PLAN_RULES.maxDurationMinutes)
    .default(120),
  seatsTotal: z.number().int().min(PLAN_RULES.minSeats).max(PLAN_RULES.maxSeats),
  wantedGenders: z
    .array(genderSchema)
    .min(1, 'Choose who can join')
    .transform((g) => [...new Set(g)]),
  /** For group plans: how many seats per gender. Must add up to seatsTotal. */
  genderMix: genderMixSchema.nullable().optional(),
  ageMin: z.number().int().min(PROFILE_RULES.minAge).max(PROFILE_RULES.maxAge).default(18),
  ageMax: z.number().int().min(PROFILE_RULES.minAge).max(PROFILE_RULES.maxAge).default(100),
  skillLevel: skillLevelSchema.default('any'),
  intent: intentSchema.default('either'),
  costSplit: costSplitSchema.default('each_pays_own'),
  costPerPersonInr: z
    .number()
    .int()
    .min(0)
    .max(PLAN_RULES.maxCostPerPersonInr)
    .nullable()
    .optional(),
  verifiedOnly: z.boolean().default(false),
  /** Verified members who pass every filter join without waiting for the host. */
  autoAccept: z.boolean().default(false),
  note: publicText(PLAN_RULES.noteMaxLength).default(''),
};

type PlanShape = {
  venueId?: string | null;
  place?: unknown;
  ageMin: number;
  ageMax: number;
  seatsTotal: number;
  wantedGenders: string[];
  genderMix?: Partial<Record<string, number>> | null;
  costSplit: string;
  costPerPersonInr?: number | null;
};

/** Cross-field rules, shared by create and (after merging) edit. */
function checkPlan(plan: PlanShape, ctx: z.RefinementCtx) {
  const hasVenue = !!plan.venueId;
  const hasPlace = !!plan.place;
  if (hasVenue === hasPlace) {
    ctx.addIssue({ code: 'custom', path: ['place'], message: 'Pick a venue or name a place' });
  }
  if (plan.ageMin > plan.ageMax) {
    ctx.addIssue({ code: 'custom', path: ['ageMax'], message: 'Age range is upside down' });
  }
  if (plan.genderMix) {
    const entries = Object.entries(plan.genderMix).filter(([, n]) => (n ?? 0) > 0);
    const sum = entries.reduce((acc, [, n]) => acc + (n ?? 0), 0);
    if (sum !== plan.seatsTotal) {
      ctx.addIssue({
        code: 'custom',
        path: ['genderMix'],
        message: 'Seats per gender must add up to the number of seats',
      });
    }
    if (entries.some(([g]) => !plan.wantedGenders.includes(g))) {
      ctx.addIssue({
        code: 'custom',
        path: ['genderMix'],
        message: 'Seats per gender can only use the genders you chose',
      });
    }
  }
  if (plan.costSplit === 'free' && (plan.costPerPersonInr ?? 0) > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['costPerPersonInr'],
      message: 'A free plan cannot have a cost',
    });
  }
}

export const createPlanRequestSchema = z.object(planFields).superRefine(checkPlan);

/**
 * Edits send only what changed. The API merges them onto the stored plan and
 * re-validates the result with the same rules as create. The activity is fixed.
 */
export const updatePlanRequestSchema = z
  .object({
    venueId: planFields.venueId,
    place: planFields.place,
    startsAt: planFields.startsAt.optional(),
    durationMinutes: planFields.durationMinutes.removeDefault().optional(),
    seatsTotal: planFields.seatsTotal.optional(),
    wantedGenders: planFields.wantedGenders.optional(),
    genderMix: planFields.genderMix,
    ageMin: planFields.ageMin.removeDefault().optional(),
    ageMax: planFields.ageMax.removeDefault().optional(),
    skillLevel: skillLevelSchema.optional(),
    intent: intentSchema.optional(),
    costSplit: costSplitSchema.optional(),
    costPerPersonInr: planFields.costPerPersonInr,
    verifiedOnly: z.boolean().optional(),
    autoAccept: z.boolean().optional(),
    note: publicText(PLAN_RULES.noteMaxLength).optional(),
  })
  .strict();

/** Query params arrive as strings; comma-separated lists for multi-select filters. */
const csv = <T extends z.ZodType<unknown, string>>(item: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(',')).map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(item).max(20));

export const feedQuerySchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    radiusKm: z.coerce
      .number()
      .min(1)
      .max(PLAN_RULES.maxRadiusKm)
      .default(PLAN_RULES.defaultRadiusKm),
    activities: csv(z.string().max(40)).optional(),
    categories: csv(activityCategorySchema).optional(),
    /** ISO datetimes bounding the start time. */
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    /** `date` also shows plans open to either; same for `friends`. */
    intent: intentSchema.optional(),
    maxCostInr: z.coerce.number().int().min(0).optional(),
    sort: feedSortSchema.default('soonest'),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(PLAN_RULES.maxPageSize)
      .default(PLAN_RULES.defaultPageSize),
    cursor: z.string().max(500).optional(),
  })
  .refine((q) => !q.from || !q.to || Date.parse(q.from) <= Date.parse(q.to), {
    path: ['to'],
    message: '`to` must be after `from`',
  });

export const myPlansQuerySchema = z.object({
  scope: z.enum(['upcoming', 'past']).default('upcoming'),
});

export const planHostSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  age: z.number().int(),
  gender: genderSchema,
  verified: z.boolean(),
  photoUrl: z.string().url().nullable(),
});

export const planSchema = z.object({
  id: z.string().uuid(),
  activity: activitySchema,
  place: z.object({
    venueId: z.string().uuid().nullable(),
    name: z.string(),
    area: z.string(),
    lat: z.number(),
    lng: z.number(),
  }),
  startsAt: z.string(),
  endsAt: z.string(),
  durationMinutes: z.number().int(),
  seats: z.object({ total: z.number().int(), taken: z.number().int(), open: z.number().int() }),
  wantedGenders: z.array(genderSchema),
  genderMix: genderMixSchema.nullable(),
  ageMin: z.number().int(),
  ageMax: z.number().int(),
  skillLevel: skillLevelSchema,
  intent: intentSchema,
  costSplit: costSplitSchema,
  costPerPersonInr: z.number().int().nullable(),
  verifiedOnly: z.boolean(),
  autoAccept: z.boolean(),
  note: z.string(),
  status: planStatusSchema,
  /** Distance from the viewer's search point, when the request had one. */
  distanceKm: z.number().nullable(),
  host: planHostSchema,
  isMine: z.boolean(),
  /** The viewer's own "I'm in" request on this plan, if any (null for the host). */
  myRequest: z
    .object({ id: z.string().uuid(), status: requestStatusSchema, expiresAt: z.string() })
    .nullable(),
  /** Host only: requests waiting for an answer. */
  pendingRequests: z.number().int().nullable(),
  /** The plan's group chat, for the host and accepted members once it exists. */
  chatId: z.string().uuid().nullable(),
  createdAt: z.string(),
});

export const feedResponseSchema = z.object({
  plans: z.array(planSchema),
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: z.string().nullable(),
});
export const myPlansResponseSchema = z.object({ plans: z.array(planSchema) });

export type Activity = z.infer<typeof activitySchema>;
export type ActivityCategory = z.infer<typeof activityCategorySchema>;
export type Venue = z.infer<typeof venueSchema>;
export type ActivitiesResponse = z.infer<typeof activitiesResponseSchema>;
export type VenuesResponse = z.infer<typeof venuesResponseSchema>;
export type SkillLevel = z.infer<typeof skillLevelSchema>;
export type CostSplit = z.infer<typeof costSplitSchema>;
export type PlanStatus = z.infer<typeof planStatusSchema>;
export type FeedSort = z.infer<typeof feedSortSchema>;
export type RequestStatus = z.infer<typeof requestStatusSchema>;
export type CreatePlanRequest = z.input<typeof createPlanRequestSchema>;
export type CreatePlan = z.output<typeof createPlanRequestSchema>;
export type UpdatePlanRequest = z.input<typeof updatePlanRequestSchema>;
export type FeedQuery = z.output<typeof feedQuerySchema>;
export type Plan = z.infer<typeof planSchema>;
export type PlanHost = z.infer<typeof planHostSchema>;
export type FeedResponse = z.infer<typeof feedResponseSchema>;

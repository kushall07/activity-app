import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** WGS84 geography point, stored by PostGIS. Read/write as EWKT, e.g. `SRID=4326;POINT(lng lat)`. */
export const geographyPoint = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geography(Point, 4326)';
  },
});

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const userStatus = pgEnum('user_status', ['active', 'suspended', 'deleted']);

/** Account identity. Cognito is the source of truth for authentication. */
export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Verified phone in E.164, e.g. +919876543210. */
    phoneE164: text('phone_e164').notNull(),
    cognitoSub: text('cognito_sub'),
    status: userStatus('status').notNull().default('active'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_phone_e164_key').on(t.phoneE164),
    uniqueIndex('users_cognito_sub_key').on(t.cognitoSub),
  ],
);

export const gender = pgEnum('gender', ['woman', 'man', 'nonbinary']);
/** What the member is open to on a plan: a date, friends, or either. */
export const intent = pgEnum('intent', ['date', 'friends', 'either']);

/** Public-facing profile, one per user. Created during onboarding. */
export const profiles = pgTable(
  'profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    birthDate: date('birth_date', { mode: 'string' }).notNull(),
    gender: gender('gender').notNull(),
    intent: intent('intent').notNull().default('either'),
    bio: text('bio').notNull().default(''),
    jobTitle: text('job_title'),
    education: text('education'),
    neighbourhood: text('neighbourhood'),
    heightCm: smallint('height_cm'),
    interests: text('interests')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Set when a selfie matched the member's photos. */
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('profiles_gender_idx').on(t.gender)],
);

export const photoStatus = pgEnum('photo_status', [
  'awaiting_upload',
  'processing',
  'approved',
  'rejected',
]);

/**
 * Profile photos. Lifecycle: awaiting_upload (presigned POST issued) ->
 * processing (upload confirmed, job queued) -> approved | rejected (worker).
 */
export const photos = pgTable(
  'photos',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    status: photoStatus('status').notNull().default('awaiting_upload'),
    /** Private S3 key the client uploads to. */
    uploadKey: text('upload_key').notNull(),
    /** Public S3 prefix (served via CloudFront) once approved. */
    publicPrefix: text('public_prefix'),
    width: integer('width'),
    height: integer('height'),
    rejectionReason: text('rejection_reason'),
    /** Raw moderation labels, kept for appeals and tuning thresholds. */
    moderationLabels: jsonb('moderation_labels'),
    ...timestamps,
  },
  (t) => [index('photos_user_position_idx').on(t.userId, t.position)],
);

export const verificationStatus = pgEnum('verification_status', [
  'awaiting_upload',
  'processing',
  'verified',
  'failed',
]);

/** Selfie verification attempts. The selfie itself is deleted after processing. */
export const selfieVerifications = pgTable(
  'selfie_verifications',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: verificationStatus('status').notNull().default('awaiting_upload'),
    uploadKey: text('upload_key').notNull(),
    /** Best face similarity (0-100) against the member's approved photos. */
    similarity: real('similarity'),
    failureReason: text('failure_reason'),
    ...timestamps,
  },
  (t) => [index('selfie_verifications_user_created_idx').on(t.userId, t.createdAt)],
);

export const activityCategory = pgEnum('activity_category', [
  'sport',
  'show',
  'workshop',
  'food',
  'outdoors',
  'art',
  'science',
  'games',
]);

/** What people do together. Reference data, seeded by migration; the slug is the stable id. */
export const activities = pgTable('activities', {
  slug: text('slug').primaryKey(),
  name: text('name').notNull(),
  category: activityCategory('category').notNull(),
  emoji: text('emoji').notNull(),
  /** Seats a new plan suggests (e.g. 3 for badminton doubles). */
  defaultSeats: smallint('default_seats').notNull().default(1),
  sortOrder: smallint('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  ...timestamps,
});

/** Places where activities happen. Curated by admins (partner portal in milestone 5). */
export const venues = pgTable(
  'venues',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    city: text('city').notNull().default('Bengaluru'),
    area: text('area'),
    address: text('address'),
    location: geographyPoint('location').notNull(),
    /** Activity slugs this venue suits, used to filter venue search. */
    activitySlugs: text('activity_slugs')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index('venues_location_gix').using('gist', t.location),
    index('venues_activity_slugs_gin').using('gin', t.activitySlugs),
  ],
);

export const skillLevel = pgEnum('skill_level', ['any', 'beginner', 'intermediate', 'advanced']);
export const costSplit = pgEnum('cost_split', [
  'free',
  'host_pays',
  'split_equally',
  'each_pays_own',
]);
export const planStatus = pgEnum('plan_status', ['open', 'full', 'cancelled', 'completed']);

/**
 * A host offers seats for an activity at a time and place. The centre of the
 * data model: requests, matches, chat and bookings (later milestones) hang off it.
 */
export const plans = pgTable(
  'plans',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    hostId: uuid('host_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    activitySlug: text('activity_slug')
      .notNull()
      .references(() => activities.slug),
    venueId: uuid('venue_id').references(() => venues.id, { onDelete: 'set null' }),
    /** Copied from the venue, or the host's own name for the place. Never a home address. */
    placeName: text('place_name').notNull(),
    area: text('area').notNull(),
    location: geographyPoint('location').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    durationMinutes: smallint('duration_minutes').notNull(),
    /** Seats offered to others (the host is not counted). */
    seatsTotal: smallint('seats_total').notNull(),
    /** Accepted requests (milestone 4 updates this in the same transaction as the accept). */
    seatsTaken: smallint('seats_taken').notNull().default(0),
    wantedGenders: gender('wanted_genders').array().notNull(),
    /** Optional seats per gender for group plans, e.g. {"woman": 2, "man": 2}. */
    genderMix: jsonb('gender_mix').$type<Partial<Record<'woman' | 'man' | 'nonbinary', number>>>(),
    ageMin: smallint('age_min').notNull().default(18),
    ageMax: smallint('age_max').notNull().default(100),
    skillLevel: skillLevel('skill_level').notNull().default('any'),
    intent: intent('intent').notNull().default('either'),
    costSplit: costSplit('cost_split').notNull().default('each_pays_own'),
    costPerPersonInr: integer('cost_per_person_inr'),
    verifiedOnly: boolean('verified_only').notNull().default(false),
    /** Accept verified members who pass every filter without asking the host. */
    autoAccept: boolean('auto_accept').notNull().default(false),
    note: text('note').notNull().default(''),
    status: planStatus('status').notNull().default('open'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    /** Bumped on every change; the search index uses it as an external version. */
    version: integer('version').notNull().default(1),
    /** Highest version written to the search index. Lower than `version` = needs indexing. */
    indexedVersion: integer('indexed_version').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index('plans_location_gix').using('gist', t.location),
    // Feed: open plans by start time (the PostGIS fallback path and "soonest" sort).
    index('plans_open_starts_at_idx')
      .on(t.startsAt)
      .where(sql`${t.status} = 'open'`),
    index('plans_host_starts_at_idx').on(t.hostId, t.startsAt),
    index('plans_activity_starts_at_idx').on(t.activitySlug, t.startsAt),
    // Search sync sweeper: rows whose latest version is not yet in the index.
    index('plans_unindexed_idx')
      .on(t.updatedAt)
      .where(sql`${t.version} > ${t.indexedVersion}`),
    check('plans_seats_check', sql`${t.seatsTaken} >= 0 and ${t.seatsTaken} <= ${t.seatsTotal}`),
    check('plans_age_check', sql`${t.ageMin} >= 18 and ${t.ageMin} <= ${t.ageMax}`),
    check('plans_wanted_genders_check', sql`cardinality(${t.wantedGenders}) > 0`),
  ],
);

// --- Requests, matching and chat (milestone 4) --------------------------------

export const requestStatus = pgEnum('request_status', [
  /** Waiting for the host. Counts as expired once `expires_at` passes. */
  'pending',
  'accepted',
  'declined',
  /** The requester took it back (before or after being accepted). */
  'withdrawn',
  /** Nobody answered in time (24 h, or the plan started). */
  'expired',
  /** The host cancelled the plan. */
  'cancelled',
]);

/**
 * "I'm in": a member asks to join a plan. One request per member per plan,
 * so a declined member cannot keep asking. Accepting takes a seat in the same
 * transaction that updates `plans.seats_taken`.
 */
export const planRequests = pgTable(
  'plan_requests',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: requestStatus('status').notNull().default('pending'),
    /** Optional note to the host. */
    message: text('message').notNull().default(''),
    /** The requester's level for this activity, when the plan asks for one. */
    skillLevel: skillLevel('skill_level'),
    /** Gender at request time; group plans count accepted seats per gender. */
    requesterGender: gender('requester_gender').notNull(),
    /** Match score 0-100 and the reasons shown to the host. */
    score: smallint('score').notNull().default(0),
    scoreReasons: text('score_reasons')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('plan_requests_plan_requester_key').on(t.planId, t.requesterId),
    // Host's request stack: pending requests for a plan, best first.
    index('plan_requests_plan_status_score_idx').on(t.planId, t.status, t.score),
    index('plan_requests_requester_created_idx').on(t.requesterId, t.createdAt),
    // Expiry sweeper.
    index('plan_requests_pending_expires_idx')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'pending'`),
    check('plan_requests_score_check', sql`${t.score} between 0 and 100`),
  ],
);

/** Either member hides the other everywhere: feed, requests and plans. */
export const blocks = pgTable(
  'blocks',
  {
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('blocks_pair_key').on(t.blockerId, t.blockedId),
    index('blocks_blocked_idx').on(t.blockedId),
    check('blocks_not_self_check', sql`${t.blockerId} <> ${t.blockedId}`),
  ],
);

/** One chat per plan: the host plus everyone accepted. Created on the first accept. */
export const chats = pgTable(
  'chats',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    /** Denormalised for the chat list's sort order. */
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [uniqueIndex('chats_plan_key').on(t.planId)],
);

export const chatRole = pgEnum('chat_role', ['host', 'member']);

export const chatMembers = pgTable(
  'chat_members',
  {
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: chatRole('role').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when the member leaves the plan; they lose access to the chat. */
    leftAt: timestamp('left_at', { withTimezone: true }),
    /** Highest message id the member has read. */
    lastReadMessageId: bigint('last_read_message_id', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    uniqueIndex('chat_members_chat_user_key').on(t.chatId, t.userId),
    index('chat_members_user_idx').on(t.userId),
  ],
);

export const messageKind = pgEnum('message_kind', ['text', 'system']);

/**
 * Chat messages. The identity id gives a total order per chat that clients use
 * for paging, catch-up after a reconnect and read markers.
 */
export const messages = pgTable(
  'messages',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    /** Null for system messages ("Asha joined"). */
    senderId: uuid('sender_id').references(() => users.id, { onDelete: 'cascade' }),
    kind: messageKind('kind').notNull().default('text'),
    body: text('body').notNull(),
    /** Client-generated id: a retried send returns the original message. */
    clientId: uuid('client_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('messages_chat_id_idx').on(t.chatId, t.id),
    uniqueIndex('messages_sender_client_key').on(t.senderId, t.clientId),
  ],
);

export const devicePlatform = pgEnum('device_platform', ['ios', 'android']);

/** Push targets: one row per app install. The SNS endpoint is created by the worker. */
export const devices = pgTable(
  'devices',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    platform: devicePlatform('platform').notNull(),
    /** Native FCM registration token or APNs device token. */
    token: text('token').notNull(),
    endpointArn: text('endpoint_arn'),
    ...timestamps,
  },
  (t) => [uniqueIndex('devices_token_key').on(t.token), index('devices_user_idx').on(t.userId)],
);

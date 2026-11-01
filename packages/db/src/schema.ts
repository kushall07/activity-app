import { sql } from 'drizzle-orm';
import {
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

/** Places where activities happen. Seeded from the event catalog in milestone 3. */
export const venues = pgTable(
  'venues',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    city: text('city').notNull().default('Bengaluru'),
    area: text('area'),
    location: geographyPoint('location').notNull(),
    ...timestamps,
  },
  (t) => [index('venues_location_gix').using('gist', t.location)],
);

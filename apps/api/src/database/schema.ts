import { sql } from 'drizzle-orm';
import {
  customType,
  index,
  pgEnum,
  pgTable,
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

/** Account identity. Profile details (photos, bio, prompts) arrive in milestone 2. */
export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** Verified phone in E.164, e.g. +919876543210. Cognito is the source of truth for auth. */
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

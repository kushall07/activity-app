import { activities, photos, plans, profiles, users } from '@activity/db';
import type { FeedFilters, FeedViewer } from '@activity/search';
import { and, eq, gt, inArray, lte, ne, or, sql, type SQL } from 'drizzle-orm';

/** A WGS84 point as PostGIS geography. */
export const geoPoint = (lat: number, lng: number) =>
  sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;

export const planEndsAt = sql`(${plans.startsAt} + make_interval(mins => ${plans.durationMinutes}))`;

const textIn = (column: SQL, values: string[]) =>
  sql`${column} in (${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )})`;

/** Who may see a plan at all: the audience the host chose. */
export function audienceWhere(viewer: FeedViewer): SQL {
  return and(
    sql`${viewer.gender}::gender = any(${plans.wantedGenders})`,
    lte(plans.ageMin, viewer.age),
    sql`${plans.ageMax} >= ${viewer.age}`,
    viewer.verified ? undefined : eq(plans.verifiedOnly, false),
  )!;
}

/**
 * The Explore feed's hard filters and the viewer's chosen filters, as SQL.
 * Used by the PostGIS feed and to re-check OpenSearch hits against Postgres,
 * so a search document that lags behind an edit can never leak a plan.
 */
export function feedWhere(viewer: FeedViewer, f: FeedFilters): SQL {
  const origin = geoPoint(f.lat, f.lng);
  return and(
    eq(plans.status, 'open'),
    gt(plans.startsAt, f.now),
    sql`${plans.seatsTaken} < ${plans.seatsTotal}`,
    sql`ST_DWithin(${plans.location}, ${origin}, ${f.radiusKm * 1000})`,
    ne(plans.hostId, viewer.userId),
    audienceWhere(viewer),
    f.activities?.length ? inArray(plans.activitySlug, f.activities) : undefined,
    f.categories?.length ? textIn(sql`${activities.category}::text`, f.categories) : undefined,
    f.intents?.length ? textIn(sql`${plans.intent}::text`, f.intents) : undefined,
    f.from ? sql`${plans.startsAt} >= ${f.from}` : undefined,
    f.to ? sql`${plans.startsAt} <= ${f.to}` : undefined,
    f.maxCostInr !== undefined
      ? or(sql`${plans.costPerPersonInr} is null`, lte(plans.costPerPersonInr, f.maxCostInr))
      : undefined,
  )!;
}

/** Distance in metres from a point (PostGIS spheroid distance). */
export const distanceFrom = (lat: number, lng: number) =>
  sql<number>`ST_Distance(${plans.location}, ${geoPoint(lat, lng)})::float8`;

/** Everything needed to render a plan card or detail page, in one round trip. */
export const planDetailColumns = (origin?: { lat: number; lng: number }) => ({
  plan: plans,
  lat: sql<number>`ST_Y(${plans.location}::geometry)::float8`,
  lng: sql<number>`ST_X(${plans.location}::geometry)::float8`,
  distanceM: origin ? distanceFrom(origin.lat, origin.lng) : sql<null>`null::float8`,
  activity: activities,
  host: {
    displayName: profiles.displayName,
    birthDate: profiles.birthDate,
    gender: profiles.gender,
    verifiedAt: profiles.verifiedAt,
  },
  hostPhotoPrefix: sql<string | null>`(
    select ${photos.publicPrefix} from ${photos}
    where ${photos.userId} = ${plans.hostId} and ${photos.status} = 'approved'
    order by ${photos.position} limit 1
  )`,
});

/** Joins for planDetailColumns. Hosts must still be active members. */
export const hostIsActive = eq(users.status, 'active');

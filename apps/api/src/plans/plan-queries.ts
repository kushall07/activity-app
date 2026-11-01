import {
  activities,
  blocks,
  chatMembers,
  chats,
  photos,
  planRequests,
  plans,
  profiles,
  users,
} from '@activity/db';
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

/** Neither the viewer nor the host has blocked the other. */
export function notBlockedWithHost(viewerId: string): SQL {
  return sql`not exists (
    select 1 from ${blocks}
    where (${blocks.blockerId} = ${viewerId} and ${blocks.blockedId} = ${plans.hostId})
       or (${blocks.blockerId} = ${plans.hostId} and ${blocks.blockedId} = ${viewerId})
  )`;
}

/** Who may see a plan at all: the audience the host chose, minus blocks either way. */
export function audienceWhere(viewer: FeedViewer): SQL {
  return and(
    sql`${viewer.gender}::gender = any(${plans.wantedGenders})`,
    lte(plans.ageMin, viewer.age),
    sql`${plans.ageMax} >= ${viewer.age}`,
    viewer.verified ? undefined : eq(plans.verifiedOnly, false),
    notBlockedWithHost(viewer.userId),
  )!;
}

/** The viewer has been accepted onto the plan (they keep seeing it whatever the host edits). */
export function acceptedOnPlan(viewerId: string): SQL {
  return sql`exists (
    select 1 from ${planRequests}
    where ${planRequests.planId} = ${plans.id} and ${planRequests.requesterId} = ${viewerId}
      and ${planRequests.status} = 'accepted'
  )`;
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
    // A host's "no" is final: declined plans leave the member's feed.
    sql`not exists (
      select 1 from ${planRequests}
      where ${planRequests.planId} = ${plans.id} and ${planRequests.requesterId} = ${viewer.userId}
        and ${planRequests.status} = 'declined'
    )`,
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
export const planDetailColumns = (origin?: { lat: number; lng: number }, viewerId?: string) => ({
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
  myRequest: viewerId
    ? sql<{ id: string; status: string; expires_at: string } | null>`(
        select json_build_object(
          'id', r.id,
          'status', case when r.status = 'pending' and r.expires_at <= now() then 'expired' else r.status::text end,
          'expires_at', r.expires_at)
        from ${planRequests} r
        where r.plan_id = ${plans.id} and r.requester_id = ${viewerId}
      )`
    : sql<null>`null`,
  pendingRequests: viewerId
    ? sql<number | null>`case when ${plans.hostId} = ${viewerId} then (
        select count(*)::int from ${planRequests} r
        where r.plan_id = ${plans.id} and r.status = 'pending' and r.expires_at > now()
      ) end`
    : sql<null>`null`,
  chatId: viewerId
    ? sql<string | null>`(
        select c.id from ${chats} c
        join ${chatMembers} m on m.chat_id = c.id and m.user_id = ${viewerId} and m.left_at is null
        where c.plan_id = ${plans.id}
      )`
    : sql<null>`null`,
});

/** Joins for planDetailColumns. Hosts must still be active members. */
export const hostIsActive = eq(users.status, 'active');

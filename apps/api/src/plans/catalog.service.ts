import { Inject, Injectable } from '@nestjs/common';
import { activities, venues } from '@activity/db';
import type { Activity, Venue } from '@activity/shared';
import { and, asc, eq, ilike, sql } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { geoPoint } from './plan-queries.js';

/** Activities and venues: the reference data the Post flow and filters are built from. */
@Injectable()
export class CatalogService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async activities(): Promise<Activity[]> {
    const rows = await this.db
      .select()
      .from(activities)
      .where(eq(activities.active, true))
      .orderBy(asc(activities.sortOrder), asc(activities.name));
    return rows.map((a) => ({
      slug: a.slug,
      name: a.name,
      category: a.category,
      emoji: a.emoji,
      defaultSeats: a.defaultSeats,
    }));
  }

  async venues(q: {
    q?: string;
    activity?: string;
    lat?: number;
    lng?: number;
    limit: number;
  }): Promise<Venue[]> {
    const origin = q.lat !== undefined && q.lng !== undefined ? geoPoint(q.lat, q.lng) : null;
    const distance = origin
      ? sql<number>`ST_Distance(${venues.location}, ${origin})::float8`
      : null;
    const rows = await this.db
      .select({
        id: venues.id,
        name: venues.name,
        area: venues.area,
        address: venues.address,
        activitySlugs: venues.activitySlugs,
        lat: sql<number>`ST_Y(${venues.location}::geometry)::float8`,
        lng: sql<number>`ST_X(${venues.location}::geometry)::float8`,
        distanceM: distance ?? sql<null>`null::float8`,
      })
      .from(venues)
      .where(
        and(
          eq(venues.active, true),
          q.q ? ilike(venues.name, `%${escapeLike(q.q)}%`) : undefined,
          q.activity ? sql`${q.activity} = any(${venues.activitySlugs})` : undefined,
        ),
      )
      .orderBy(distance ? asc(distance) : asc(venues.name))
      .limit(q.limit);
    return rows.map((v) => ({
      id: v.id,
      name: v.name,
      area: v.area,
      address: v.address,
      lat: v.lat,
      lng: v.lng,
      activities: v.activitySlugs,
      distanceKm: v.distanceM === null ? null : Math.round(v.distanceM / 100) / 10,
    }));
  }
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

import { Inject, Injectable, Logger } from '@nestjs/common';
import { activities, plans } from '@activity/db';
import type { FeedQuery, FeedResponse } from '@activity/shared';
import {
  buildFeedSearch,
  parseFeedHits,
  PLANS_ALIAS,
  type FeedCursor,
  type FeedFilters,
  type FeedViewer,
} from '@activity/search';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DRIZZLE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { decodeCursor, encodeCursor } from './cursor.js';
import { distanceFrom, feedWhere } from './plan-queries.js';
import { PlansService } from './plans.service.js';
import { SEARCH_CLIENT, type MaybeSearchClient } from './search.module.js';
import { ViewerService } from './viewer.service.js';

interface Candidate {
  id: string;
  cursor: FeedCursor;
}

/**
 * The Explore feed. Candidates come from OpenSearch (or PostGIS), then the
 * page is read from Postgres with the same filters re-applied, so the feed is
 * never wrong even when the index lags a few seconds behind.
 */
@Injectable()
export class FeedService {
  private readonly logger = new Logger(FeedService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(SEARCH_CLIENT) private readonly search: MaybeSearchClient,
    private readonly viewers: ViewerService,
    private readonly plansService: PlansService,
  ) {}

  async feed(userId: string, q: FeedQuery): Promise<FeedResponse> {
    const viewer = await this.viewers.require(userId);
    const filters = toFilters(q);

    let candidates: Candidate[];
    if (this.search) {
      try {
        candidates = await this.fromOpenSearch(viewer, filters);
      } catch (err) {
        this.logger.warn(`OpenSearch feed failed, using PostGIS: ${(err as Error).message}`);
        candidates = await this.fromPostgres(viewer, filters);
      }
    } else {
      candidates = await this.fromPostgres(viewer, filters);
    }

    const hasMore = candidates.length > q.limit;
    const page = candidates.slice(0, q.limit);
    const items = await this.plansService.hydrate(
      page.map((c) => c.id),
      feedWhere(viewer, { ...filters, cursor: undefined }),
      viewer,
      { lat: q.lat, lng: q.lng },
    );
    return {
      plans: items,
      nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]!.cursor) : null,
    };
  }

  private async fromOpenSearch(viewer: FeedViewer, f: FeedFilters): Promise<Candidate[]> {
    const res = await this.search!.search({
      index: PLANS_ALIAS,
      body: buildFeedSearch(viewer, f) as never,
    });
    return parseFeedHits(res.body).map((h) => ({
      id: h.id,
      cursor:
        f.sort === 'soonest'
          ? { sort: 'soonest', startsAtMs: Number(h.sort[0]), id: h.id }
          : { sort: 'nearest', distanceM: Number(h.sort[0]), id: h.id },
    }));
  }

  private async fromPostgres(viewer: FeedViewer, f: FeedFilters): Promise<Candidate[]> {
    const distance = distanceFrom(f.lat, f.lng);
    let after;
    if (f.cursor?.sort === 'soonest') {
      after = sql`(${plans.startsAt}, ${plans.id}) > (${new Date(f.cursor.startsAtMs)}, ${f.cursor.id}::uuid)`;
    } else if (f.cursor?.sort === 'nearest') {
      after = sql`(${distance}, ${plans.id}) > (${f.cursor.distanceM}::float8, ${f.cursor.id}::uuid)`;
    }
    const rows = await this.db
      .select({ id: plans.id, startsAt: plans.startsAt, distanceM: distance })
      .from(plans)
      .innerJoin(activities, eq(activities.slug, plans.activitySlug))
      .where(and(feedWhere(viewer, f), after))
      .orderBy(...(f.sort === 'soonest' ? [asc(plans.startsAt)] : [asc(distance)]), asc(plans.id))
      .limit(f.size);
    return rows.map((r) => ({
      id: r.id,
      cursor:
        f.sort === 'soonest'
          ? { sort: 'soonest', startsAtMs: r.startsAt.getTime(), id: r.id }
          : { sort: 'nearest', distanceM: r.distanceM, id: r.id },
    }));
  }
}

export function toFilters(q: FeedQuery, now = new Date()): FeedFilters {
  return {
    lat: q.lat,
    lng: q.lng,
    radiusKm: q.radiusKm,
    activities: q.activities,
    categories: q.categories,
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to) : undefined,
    // Someone looking for a date also sees plans open to either; same for friends.
    intents: q.intent && q.intent !== 'either' ? [q.intent, 'either'] : undefined,
    maxCostInr: q.maxCostInr,
    sort: q.sort,
    size: q.limit + 1,
    cursor: q.cursor ? decodeCursor(q.cursor, q.sort) : undefined,
    now,
  };
}

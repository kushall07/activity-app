import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { activities, plans, profiles, users, venues } from '@activity/db';
import {
  ageOn,
  BENGALURU_AREAS,
  createPlanRequestSchema,
  JOB_TYPES,
  PLAN_RULES,
  storageKeys,
  updatePlanRequestSchema,
  type CreatePlan,
  type Plan,
  type PlanIndexPayload,
} from '@activity/shared';
import { and, asc, desc, eq, gt, inArray, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { ApiException } from '../common/errors.js';
import { JobsService } from '../common/jobs.service.js';
import { RateLimiter } from '../common/rate-limiter.js';
import { StorageService } from '../common/storage.service.js';
import { DRIZZLE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { audienceWhere, geoPoint, planDetailColumns, planEndsAt } from './plan-queries.js';
import { SEARCH_CLIENT, type MaybeSearchClient } from './search.module.js';
import { ViewerService, type Viewer } from './viewer.service.js';

type UpdatePlan = z.output<typeof updatePlanRequestSchema>;
type PlanRow = typeof plans.$inferSelect;
type DetailRow = {
  plan: PlanRow;
  lat: number;
  lng: number;
  distanceM: number | null;
  activity: typeof activities.$inferSelect;
  host: {
    displayName: string;
    birthDate: string;
    gender: 'woman' | 'man' | 'nonbinary';
    verifiedAt: Date | null;
  };
  hostPhotoPrefix: string | null;
};

const notFound = () => new ApiException(HttpStatus.NOT_FOUND, 'not_found', 'Plan not found');

@Injectable()
export class PlansService {
  private readonly logger = new Logger(PlansService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(SEARCH_CLIENT) private readonly search: MaybeSearchClient,
    private readonly viewers: ViewerService,
    private readonly jobs: JobsService,
    private readonly limiter: RateLimiter,
    private readonly storage: StorageService,
  ) {}

  async create(userId: string, input: CreatePlan): Promise<Plan> {
    await this.viewers.require(userId, { verified: true });
    await this.limiter.consume(
      `plans:create:${userId}`,
      PLAN_RULES.maxPlansPerDay,
      24 * 3600,
      'You have posted a lot of plans today. Try again tomorrow.',
    );

    const [activity] = await this.db
      .select()
      .from(activities)
      .where(and(eq(activities.slug, input.activitySlug), eq(activities.active, true)));
    if (!activity) {
      throw new ApiException(HttpStatus.BAD_REQUEST, 'unknown_activity', 'Unknown activity');
    }
    this.assertStartTime(new Date(input.startsAt));
    const place = await this.resolvePlace(input);

    const [{ active } = { active: 0 }] = await this.db
      .select({ active: sql<number>`count(*)::int` })
      .from(plans)
      .where(
        and(
          eq(plans.hostId, userId),
          inArray(plans.status, ['open', 'full']),
          gt(plans.startsAt, new Date()),
        ),
      );
    if (active >= PLAN_RULES.maxActivePlansPerHost) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'too_many_plans',
        `You can have up to ${PLAN_RULES.maxActivePlansPerHost} upcoming plans at once`,
      );
    }

    const [row] = await this.db
      .insert(plans)
      .values({
        hostId: userId,
        activitySlug: activity.slug,
        ...place,
        ...this.planValues(input),
      })
      .returning({ id: plans.id, version: plans.version });
    await this.enqueueIndex(row!.id, row!.version);
    return this.getForHost(userId, row!.id);
  }

  /**
   * Partial edit by the host. The change is merged onto the stored plan and the
   * result is validated with the same rules as a new plan.
   */
  async update(userId: string, planId: string, patch: UpdatePlan): Promise<Plan> {
    const version = await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          plan: plans,
          lat: sql<number>`ST_Y(${plans.location}::geometry)::float8`,
          lng: sql<number>`ST_X(${plans.location}::geometry)::float8`,
        })
        .from(plans)
        .where(and(eq(plans.id, planId), eq(plans.hostId, userId)))
        .for('update');
      if (!current) throw notFound();
      const p = current.plan;
      this.assertEditable(p);

      const merged = createPlanRequestSchema.safeParse({
        activitySlug: p.activitySlug,
        venueId: p.venueId,
        place: p.venueId
          ? null
          : { name: p.placeName, area: p.area, lat: current.lat, lng: current.lng },
        startsAt: p.startsAt.toISOString(),
        durationMinutes: p.durationMinutes,
        seatsTotal: p.seatsTotal,
        wantedGenders: p.wantedGenders,
        genderMix: p.genderMix,
        ageMin: p.ageMin,
        ageMax: p.ageMax,
        skillLevel: p.skillLevel,
        intent: p.intent,
        costSplit: p.costSplit,
        costPerPersonInr: p.costPerPersonInr,
        verifiedOnly: p.verifiedOnly,
        note: p.note,
        ...patch,
        // Switching between a venue and a custom place clears the other.
        ...(patch.venueId ? { place: null } : {}),
        ...(patch.place ? { venueId: null } : {}),
      });
      if (!merged.success) {
        const issue = merged.error.issues[0];
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          'invalid_request',
          `${issue?.path.length ? `${issue.path.join('.')}: ` : ''}${issue?.message ?? 'Invalid plan'}`,
        );
      }
      const next = merged.data;
      if (patch.startsAt) this.assertStartTime(new Date(next.startsAt));
      if (next.seatsTotal < p.seatsTaken) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'seats_below_taken',
          `${p.seatsTaken} people have already joined; keep at least that many seats`,
        );
      }
      const placeChanged =
        patch.venueId !== undefined || patch.place !== undefined
          ? await this.resolvePlace(next)
          : {};

      const [row] = await tx
        .update(plans)
        .set({
          ...placeChanged,
          ...this.planValues(next),
          status: p.seatsTaken >= next.seatsTotal ? 'full' : 'open',
          version: sql`${plans.version} + 1`,
        })
        .where(eq(plans.id, planId))
        .returning({ version: plans.version });
      return row!.version;
    });
    await this.enqueueIndex(planId, version);
    return this.getForHost(userId, planId);
  }

  /** Idempotent: cancelling a cancelled plan returns it unchanged. */
  async cancel(userId: string, planId: string): Promise<Plan> {
    const [row] = await this.db
      .update(plans)
      .set({ status: 'cancelled', cancelledAt: new Date(), version: sql`${plans.version} + 1` })
      .where(
        and(
          eq(plans.id, planId),
          eq(plans.hostId, userId),
          inArray(plans.status, ['open', 'full']),
        ),
      )
      .returning({ version: plans.version });
    if (row) {
      await this.enqueueIndex(planId, row.version);
    } else {
      // Either not theirs / missing (404) or already cancelled/completed (return as is).
      await this.getForHost(userId, planId);
    }
    return this.getForHost(userId, planId);
  }

  /**
   * Plan details. The host always sees their plan; anyone else sees it only if
   * they are in the audience the host chose and the plan is still on.
   */
  async get(userId: string, planId: string, origin?: { lat: number; lng: number }): Promise<Plan> {
    const [own] = await this.db
      .select({ hostId: plans.hostId })
      .from(plans)
      .where(eq(plans.id, planId));
    if (!own) throw notFound();
    if (own.hostId === userId) return this.getForHost(userId, planId, origin);

    const viewer = await this.viewers.require(userId);
    const [plan] = await this.selectDetails(
      and(
        eq(plans.id, planId),
        inArray(plans.status, ['open', 'full']),
        sql`${planEndsAt} > now()`,
        audienceWhere(viewer),
      )!,
      origin,
    );
    if (!plan) throw notFound();
    return plan;
  }

  async mine(userId: string, scope: 'upcoming' | 'past'): Promise<Plan[]> {
    const upcoming = and(inArray(plans.status, ['open', 'full']), sql`${planEndsAt} > now()`);
    return this.selectDetails(
      and(eq(plans.hostId, userId), scope === 'upcoming' ? upcoming : sql`not (${upcoming})`)!,
      undefined,
      scope === 'upcoming' ? [asc(plans.startsAt)] : [desc(plans.startsAt)],
      50,
      userId,
    );
  }

  /**
   * Loads plans by id for the feed, keeping the given order. `where` re-applies
   * the feed filters so only plans that still qualify are returned.
   */
  async hydrate(
    ids: string[],
    where: SQL,
    viewer: Viewer,
    origin: { lat: number; lng: number },
  ): Promise<Plan[]> {
    if (ids.length === 0) return [];
    const rows = await this.selectDetails(
      and(inArray(plans.id, ids), where)!,
      origin,
      undefined,
      ids.length,
      viewer.userId,
    );
    const byId = new Map(rows.map((p) => [p.id, p]));
    return ids.map((id) => byId.get(id)).filter((p): p is Plan => !!p);
  }

  private async getForHost(userId: string, planId: string, origin?: { lat: number; lng: number }) {
    const [plan] = await this.selectDetails(
      and(eq(plans.id, planId), eq(plans.hostId, userId))!,
      origin,
      undefined,
      1,
      userId,
    );
    if (!plan) throw notFound();
    return plan;
  }

  private async selectDetails(
    where: SQL,
    origin?: { lat: number; lng: number },
    orderBy: SQL[] = [asc(plans.startsAt)],
    limit = 50,
    viewerId?: string,
  ): Promise<Plan[]> {
    const rows = (await this.db
      .select(planDetailColumns(origin))
      .from(plans)
      .innerJoin(activities, eq(activities.slug, plans.activitySlug))
      .innerJoin(profiles, eq(profiles.userId, plans.hostId))
      .innerJoin(users, and(eq(users.id, plans.hostId), eq(users.status, 'active')))
      .where(where)
      .orderBy(...orderBy)
      .limit(limit)) as DetailRow[];
    return rows.map((r) => this.toPlan(r, viewerId));
  }

  private toPlan(r: DetailRow, viewerId?: string): Plan {
    const p = r.plan;
    const endsAt = new Date(p.startsAt.getTime() + p.durationMinutes * 60_000);
    const ended = endsAt.getTime() <= Date.now();
    return {
      id: p.id,
      activity: {
        slug: r.activity.slug,
        name: r.activity.name,
        category: r.activity.category,
        emoji: r.activity.emoji,
        defaultSeats: r.activity.defaultSeats,
      },
      place: { venueId: p.venueId, name: p.placeName, area: p.area, lat: r.lat, lng: r.lng },
      startsAt: p.startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      durationMinutes: p.durationMinutes,
      seats: {
        total: p.seatsTotal,
        taken: p.seatsTaken,
        open: Math.max(p.seatsTotal - p.seatsTaken, 0),
      },
      wantedGenders: p.wantedGenders,
      genderMix: p.genderMix ?? null,
      ageMin: p.ageMin,
      ageMax: p.ageMax,
      skillLevel: p.skillLevel,
      intent: p.intent,
      costSplit: p.costSplit,
      costPerPersonInr: p.costPerPersonInr,
      verifiedOnly: p.verifiedOnly,
      note: p.note,
      // A plan that has ended reads as completed until milestone 7's check-in flow closes it.
      status: ended && (p.status === 'open' || p.status === 'full') ? 'completed' : p.status,
      distanceKm: r.distanceM === null ? null : Math.round(r.distanceM / 100) / 10,
      host: {
        userId: p.hostId,
        displayName: r.host.displayName,
        age: ageOn(r.host.birthDate),
        gender: r.host.gender,
        verified: !!r.host.verifiedAt,
        photoUrl: r.hostPhotoPrefix
          ? this.storage.publicUrl(storageKeys.photoVariant(r.hostPhotoPrefix, 'thumb'))
          : null,
      },
      isMine: p.hostId === viewerId,
      createdAt: p.createdAt.toISOString(),
    };
  }

  private planValues(input: CreatePlan) {
    return {
      startsAt: new Date(input.startsAt),
      durationMinutes: input.durationMinutes,
      seatsTotal: input.seatsTotal,
      wantedGenders: input.wantedGenders,
      genderMix: input.genderMix
        ? Object.fromEntries(Object.entries(input.genderMix).filter(([, n]) => (n ?? 0) > 0))
        : null,
      ageMin: input.ageMin,
      ageMax: input.ageMax,
      skillLevel: input.skillLevel,
      intent: input.intent,
      costSplit: input.costSplit,
      costPerPersonInr: input.costSplit === 'free' ? 0 : (input.costPerPersonInr ?? null),
      verifiedOnly: input.verifiedOnly,
      note: input.note,
    };
  }

  /** A listed venue, or a named place in a known neighbourhood (never an address). */
  private async resolvePlace(input: Pick<CreatePlan, 'venueId' | 'place'>) {
    if (input.venueId) {
      const [venue] = await this.db
        .select({
          id: venues.id,
          name: venues.name,
          area: venues.area,
          location: venues.location,
        })
        .from(venues)
        .where(and(eq(venues.id, input.venueId), eq(venues.active, true)));
      if (!venue) {
        throw new ApiException(HttpStatus.BAD_REQUEST, 'unknown_venue', 'Unknown venue');
      }
      return {
        venueId: venue.id,
        placeName: venue.name,
        area: venue.area ?? 'Bengaluru',
        location: sql`${venue.location}::geography` as unknown as string,
      };
    }
    const place = input.place!;
    const area = BENGALURU_AREAS.find((a) => a.name === place.area)!;
    const lat = place.lat ?? area.lat;
    const lng = place.lng ?? area.lng;
    return {
      venueId: null,
      placeName: place.name,
      area: area.name,
      location: geoPoint(lat, lng) as unknown as string,
    };
  }

  private assertStartTime(startsAt: Date) {
    const now = Date.now();
    const earliest = now + PLAN_RULES.minLeadMinutes * 60_000;
    const latest = now + PLAN_RULES.maxLeadDays * 24 * 3600_000;
    if (startsAt.getTime() < earliest || startsAt.getTime() > latest) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'invalid_start_time',
        `Pick a start time between ${PLAN_RULES.minLeadMinutes} minutes and ${PLAN_RULES.maxLeadDays} days from now`,
      );
    }
  }

  private assertEditable(p: PlanRow) {
    if (p.status !== 'open' && p.status !== 'full') {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'plan_closed',
        'This plan can no longer be edited',
      );
    }
    if (p.startsAt.getTime() <= Date.now()) {
      throw new ApiException(HttpStatus.CONFLICT, 'plan_started', 'This plan has already started');
    }
  }

  /**
   * Fast path to the search index. If the enqueue fails, the worker's sweeper
   * still picks the plan up (version > indexed_version), so this never fails the request.
   */
  private async enqueueIndex(planId: string, version: number) {
    if (!this.search) return;
    try {
      await this.jobs.enqueue<PlanIndexPayload>(
        JOB_TYPES.planIndex,
        { planId, version },
        `${JOB_TYPES.planIndex}:${planId}:${version}`,
      );
    } catch (err) {
      this.logger.warn(
        `Could not enqueue ${JOB_TYPES.planIndex} for ${planId}: ${(err as Error).message}`,
      );
    }
  }
}

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  activities,
  blocks,
  chats,
  chatMembers,
  photos,
  planRequests,
  plans,
  profiles,
  users,
} from '@activity/db';
import {
  ageOn,
  REQUEST_RULES,
  storageKeys,
  type MyRequest,
  type PlanRequest,
  type PlanRequestsResponse,
  type RequestDecisionResponse,
  type RequestStatus,
} from '@activity/shared';
import { and, asc, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { createRequestSchema } from '@activity/shared';
import { ChatService, type ChatChange } from '../chat/chat.service.js';
import { ApiException } from '../common/errors.js';
import { NotifierService } from '../common/notifier.service.js';
import { RateLimiter } from '../common/rate-limiter.js';
import { StorageService } from '../common/storage.service.js';
import { DRIZZLE } from '../database/database.constants.js';
import type { Database } from '../database/database.module.js';
import { scoreRequest } from '../matching/score.js';
import { audienceWhere } from '../plans/plan-queries.js';
import { PlansService } from '../plans/plans.service.js';
import { ViewerService } from '../plans/viewer.service.js';

type CreateRequest = z.output<typeof createRequestSchema>;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type PlanRow = typeof plans.$inferSelect;
type RequestRow = typeof planRequests.$inferSelect;
type Gender = 'woman' | 'man' | 'nonbinary';

const err = (status: HttpStatus, code: string, message: string) =>
  new ApiException(status, code, message);
const planNotFound = () => err(HttpStatus.NOT_FOUND, 'not_found', 'Plan not found');
const requestNotFound = () => err(HttpStatus.NOT_FOUND, 'not_found', 'Request not found');

const GENDER_WORD: Record<Gender, string> = {
  woman: 'women',
  man: 'men',
  nonbinary: 'non-binary people',
};

/** What to do after the transaction commits: reindex, fan out to chat, push. */
interface Effects {
  planId: string;
  planVersion?: number;
  chat?: ChatChange | null;
  push?: Parameters<NotifierService['push']>[0][];
}

/**
 * "I'm in" requests and the host's request stack.
 *
 * Every state change that touches seats runs in one transaction holding the
 * plan row lock (`select ... for update`), so two hosts' taps, an auto-accept
 * and a member leaving can never oversell a plan or a per-gender seat. The
 * `plans_seats_check` constraint backs this up in the database.
 */
@Injectable()
export class RequestsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly viewers: ViewerService,
    private readonly plansService: PlansService,
    private readonly chat: ChatService,
    private readonly notifier: NotifierService,
    private readonly limiter: RateLimiter,
    private readonly storage: StorageService,
  ) {}

  // --- Member asks to join ----------------------------------------------------

  async create(
    userId: string,
    planId: string,
    input: CreateRequest,
  ): Promise<RequestDecisionResponse> {
    const viewer = await this.viewers.require(userId);
    const [me] = await this.db
      .select({
        displayName: profiles.displayName,
        interests: profiles.interests,
        intent: profiles.intent,
        neighbourhood: profiles.neighbourhood,
        joinedAt: users.createdAt,
      })
      .from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId))
      .where(eq(profiles.userId, userId));

    const result = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          plan: plans,
          lat: sql<number>`ST_Y(${plans.location}::geometry)::float8`,
          lng: sql<number>`ST_X(${plans.location}::geometry)::float8`,
          activityName: activities.name,
          hostActive: sql<boolean>`${users.status} = 'active'`,
        })
        .from(plans)
        .innerJoin(activities, eq(activities.slug, plans.activitySlug))
        .innerJoin(users, eq(users.id, plans.hostId))
        .where(and(eq(plans.id, planId), audienceWhere(viewer)))
        .for('update', { of: plans });
      if (!row || !row.hostActive) {
        // The host's own plan is never in their audience query; say so plainly.
        const [own] = await tx
          .select({ id: plans.id })
          .from(plans)
          .where(and(eq(plans.id, planId), eq(plans.hostId, userId)));
        if (own) throw err(HttpStatus.BAD_REQUEST, 'own_plan', 'This is your own plan');
        throw planNotFound();
      }
      const p = row.plan;
      if (p.hostId === userId)
        throw err(HttpStatus.BAD_REQUEST, 'own_plan', 'This is your own plan');
      this.assertJoinable(p);

      const [existing] = await tx
        .select({ id: planRequests.id })
        .from(planRequests)
        .where(and(eq(planRequests.planId, planId), eq(planRequests.requesterId, userId)));
      if (existing) {
        throw err(
          HttpStatus.CONFLICT,
          'already_requested',
          'You have already asked to join this plan',
        );
      }
      await this.assertSeatFor(tx, p, viewer.gender as Gender);

      const [{ pending } = { pending: 0 }] = await tx
        .select({ pending: sql<number>`count(*)::int` })
        .from(planRequests)
        .where(
          and(
            eq(planRequests.planId, planId),
            eq(planRequests.status, 'pending'),
            sql`${planRequests.expiresAt} > now()`,
          ),
        );
      if (pending >= REQUEST_RULES.maxPendingPerPlan) {
        throw err(
          HttpStatus.CONFLICT,
          'plan_busy',
          'This plan already has lots of people waiting. Try another one, or check back later.',
        );
      }

      // Counted last, so a request refused above does not use up the member's daily five.
      await this.limiter.consume(
        `requests:create:${userId}`,
        REQUEST_RULES.maxPerDay,
        24 * 3600,
        `You can send ${REQUEST_RULES.maxPerDay} requests a day. Try again tomorrow.`,
      );

      const { score, reasons } = scoreRequest(
        {
          activitySlug: p.activitySlug,
          activityName: row.activityName,
          lat: row.lat,
          lng: row.lng,
          skillLevel: p.skillLevel,
          intent: p.intent,
        },
        {
          neighbourhood: me?.neighbourhood ?? viewer.neighbourhood,
          interests: me?.interests ?? [],
          intent: me?.intent ?? 'either',
          verified: viewer.verified,
          skillLevel: input.skillLevel ?? null,
          joinedAt: me?.joinedAt ?? new Date(),
        },
      );
      const expiresAt = new Date(
        Math.min(Date.now() + REQUEST_RULES.ttlHours * 3600_000, p.startsAt.getTime()),
      );
      const [request] = await tx
        .insert(planRequests)
        .values({
          planId,
          requesterId: userId,
          message: input.message,
          skillLevel: input.skillLevel ?? null,
          requesterGender: viewer.gender as Gender,
          score,
          scoreReasons: reasons,
          expiresAt,
        })
        .returning();

      const name = me?.displayName ?? 'Someone';
      if (p.autoAccept && viewer.verified) {
        const accepted = await this.acceptLocked(tx, p, request!, name);
        return {
          request: request!,
          status: 'accepted' as const,
          effects: {
            ...accepted,
            push: [
              {
                userIds: [p.hostId],
                title: `${name} joined your plan`,
                body: `${row.activityName}: they were auto-accepted. Say hi in the chat.`,
                data: { kind: 'request.accepted' as const, planId, chatId: accepted.chat!.chatId },
              },
            ],
          },
        };
      }
      return {
        request: request!,
        status: 'pending' as const,
        effects: {
          planId,
          push: [
            {
              userIds: [p.hostId],
              title: `${name} wants to join`,
              body: `${row.activityName}: ${input.message || 'Tap to see their profile.'}`,
              data: { kind: 'request.new' as const, planId },
              collapseKey: `requests:${planId}`,
            },
          ],
        },
      };
    });

    await this.runEffects(result.effects);
    return {
      request: { id: result.request.id, status: result.status },
      plan: await this.plansService.get(userId, planId),
    };
  }

  // --- Host decides -----------------------------------------------------------

  async accept(hostId: string, requestId: string): Promise<RequestDecisionResponse> {
    const result = await this.db.transaction(async (tx) => {
      const { plan, request } = await this.lockForHost(tx, hostId, requestId);
      this.assertPending(request);
      this.assertJoinable(plan);
      const [blocked] = await tx
        .select({ x: sql`1` })
        .from(blocks)
        .where(
          or(
            and(eq(blocks.blockerId, hostId), eq(blocks.blockedId, request.requesterId)),
            and(eq(blocks.blockerId, request.requesterId), eq(blocks.blockedId, hostId)),
          ),
        );
      if (blocked) throw requestNotFound();
      const [who] = await tx
        .select({ name: profiles.displayName })
        .from(profiles)
        .where(eq(profiles.userId, request.requesterId));
      const [activity] = await tx
        .select({ name: activities.name })
        .from(activities)
        .where(eq(activities.slug, plan.activitySlug));
      const effects = await this.acceptLocked(tx, plan, request, who?.name ?? 'Someone');
      const [host] = await tx
        .select({ name: profiles.displayName })
        .from(profiles)
        .where(eq(profiles.userId, hostId));
      effects.push = [
        {
          userIds: [request.requesterId],
          title: "You're in! 🎉",
          body: `${host?.name ?? 'The host'} accepted you for ${activity?.name ?? 'their plan'}. Say hi in the chat.`,
          data: { kind: 'request.accepted', planId: plan.id, chatId: effects.chat!.chatId },
        },
      ];
      return { planId: plan.id, effects };
    });
    await this.runEffects(result.effects);
    return {
      request: { id: requestId, status: 'accepted' },
      plan: await this.plansService.getForHost(hostId, result.planId),
    };
  }

  /** No push for a decline: the member sees "not this time" in the app, gently. */
  async decline(hostId: string, requestId: string): Promise<RequestDecisionResponse> {
    const planId = await this.db.transaction(async (tx) => {
      const { plan, request } = await this.lockForHost(tx, hostId, requestId);
      this.assertPending(request);
      await tx
        .update(planRequests)
        .set({ status: 'declined', decidedAt: new Date() })
        .where(eq(planRequests.id, request.id));
      return plan.id;
    });
    return {
      request: { id: requestId, status: 'declined' },
      plan: await this.plansService.getForHost(hostId, planId),
    };
  }

  // --- Member takes it back ---------------------------------------------------

  /**
   * Withdraws a waiting request, or leaves a plan after being accepted (frees
   * the seat and leaves the chat). Only before the plan starts.
   */
  async withdraw(userId: string, requestId: string): Promise<RequestDecisionResponse> {
    const result = await this.db.transaction(async (tx) => {
      const [found] = await tx
        .select({ planId: planRequests.planId })
        .from(planRequests)
        .where(and(eq(planRequests.id, requestId), eq(planRequests.requesterId, userId)));
      if (!found) throw requestNotFound();
      // Lock order is always plan, then request (same as accept), so they cannot deadlock.
      const [plan] = await tx.select().from(plans).where(eq(plans.id, found.planId)).for('update');
      const [request] = await tx
        .select()
        .from(planRequests)
        .where(eq(planRequests.id, requestId))
        .for('update');
      if (!plan || !request) throw requestNotFound();

      if (request.status === 'withdrawn') return { planId: plan.id, effects: { planId: plan.id } };
      if (request.status !== 'pending' && request.status !== 'accepted') {
        throw err(HttpStatus.CONFLICT, 'request_closed', 'This request is already closed');
      }
      if (plan.startsAt.getTime() <= Date.now()) {
        throw err(HttpStatus.CONFLICT, 'plan_started', 'This plan has already started');
      }
      await tx
        .update(planRequests)
        .set({ status: 'withdrawn', decidedAt: new Date() })
        .where(eq(planRequests.id, requestId));
      if (request.status === 'pending') return { planId: plan.id, effects: { planId: plan.id } };

      const [updated] = await tx
        .update(plans)
        .set({
          seatsTaken: sql`${plans.seatsTaken} - 1`,
          status: sql`case when ${plans.status} = 'full' then 'open'::plan_status else ${plans.status} end`,
          version: sql`${plans.version} + 1`,
        })
        .where(eq(plans.id, plan.id))
        .returning({ version: plans.version });
      const [who] = await tx
        .select({ name: profiles.displayName })
        .from(profiles)
        .where(eq(profiles.userId, userId));
      const chat = await this.chat.leave(
        tx,
        plan.id,
        userId,
        `${who?.name ?? 'Someone'} left the plan.`,
      );
      return { planId: plan.id, effects: { planId: plan.id, planVersion: updated!.version, chat } };
    });
    await this.runEffects(result.effects);
    return {
      request: { id: requestId, status: 'withdrawn' },
      // A member who left may no longer be in the plan's audience.
      plan: await this.plansService.get(userId, result.planId).catch(() => null),
    };
  }

  // --- Reads --------------------------------------------------------------------

  /** The host's stack: waiting requests best match first, then who is in. */
  async forPlan(hostId: string, planId: string): Promise<PlanRequestsResponse> {
    const [plan] = await this.db
      .select({ id: plans.id })
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.hostId, hostId)));
    if (!plan) throw planNotFound();

    const [pending, accepted] = await Promise.all([
      this.selectRequests(
        and(
          eq(planRequests.planId, planId),
          eq(planRequests.status, 'pending'),
          sql`${planRequests.expiresAt} > now()`,
        )!,
        [desc(planRequests.score), asc(planRequests.createdAt)],
      ),
      this.selectRequests(
        and(eq(planRequests.planId, planId), eq(planRequests.status, 'accepted'))!,
        [asc(planRequests.decidedAt)],
      ),
    ]);
    return { pending, accepted };
  }

  async mine(userId: string): Promise<MyRequest[]> {
    const rows = await this.db
      .select({
        r: planRequests,
        plan: plans,
        activity: activities,
        hostName: profiles.displayName,
        hostPhotoPrefix: sql<string | null>`(
          select ${photos.publicPrefix} from ${photos}
          where ${photos.userId} = ${plans.hostId} and ${photos.status} = 'approved'
          order by ${photos.position} limit 1)`,
        chatId: sql<string | null>`(
          select c.id from ${chats} c
          join ${chatMembers} m on m.chat_id = c.id and m.user_id = ${userId} and m.left_at is null
          where c.plan_id = ${plans.id})`,
      })
      .from(planRequests)
      .innerJoin(plans, eq(plans.id, planRequests.planId))
      .innerJoin(activities, eq(activities.slug, plans.activitySlug))
      .innerJoin(profiles, eq(profiles.userId, plans.hostId))
      .where(eq(planRequests.requesterId, userId))
      .orderBy(desc(planRequests.createdAt))
      .limit(50);
    return rows.map(({ r, plan, activity, hostName, hostPhotoPrefix, chatId }) => ({
      id: r.id,
      status: effectiveStatus(r),
      message: r.message,
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      chatId,
      plan: {
        id: plan.id,
        activity: {
          slug: activity.slug,
          name: activity.name,
          category: activity.category,
          emoji: activity.emoji,
          defaultSeats: activity.defaultSeats,
        },
        startsAt: plan.startsAt.toISOString(),
        placeName: plan.placeName,
        area: plan.area,
        hostName,
        hostPhotoUrl: hostPhotoPrefix
          ? this.storage.publicUrl(storageKeys.photoVariant(hostPhotoPrefix, 'thumb'))
          : null,
      },
    }));
  }

  // --- Blocks -------------------------------------------------------------------

  /**
   * Hides the two members from each other: plans, requests and the feed.
   * Waiting requests between them are declined. (Reports, and leaving shared
   * plans, arrive with the safety milestone.)
   */
  async block(userId: string, otherId: string): Promise<void> {
    if (userId === otherId)
      throw err(HttpStatus.BAD_REQUEST, 'invalid_request', 'You cannot block yourself');
    const [other] = await this.db.select({ id: users.id }).from(users).where(eq(users.id, otherId));
    if (!other) throw err(HttpStatus.NOT_FOUND, 'not_found', 'Member not found');
    await this.db.transaction(async (tx) => {
      await tx
        .insert(blocks)
        .values({ blockerId: userId, blockedId: otherId })
        .onConflictDoNothing();
      await tx
        .update(planRequests)
        .set({ status: 'declined', decidedAt: new Date() })
        .where(
          and(
            eq(planRequests.status, 'pending'),
            or(
              and(
                eq(planRequests.requesterId, otherId),
                inArray(
                  planRequests.planId,
                  tx.select({ id: plans.id }).from(plans).where(eq(plans.hostId, userId)),
                ),
              ),
              and(
                eq(planRequests.requesterId, userId),
                inArray(
                  planRequests.planId,
                  tx.select({ id: plans.id }).from(plans).where(eq(plans.hostId, otherId)),
                ),
              ),
            ),
          ),
        );
    });
  }

  async unblock(userId: string, otherId: string): Promise<void> {
    await this.db
      .delete(blocks)
      .where(and(eq(blocks.blockerId, userId), eq(blocks.blockedId, otherId)));
  }

  // --- Internals ----------------------------------------------------------------

  /**
   * Takes a seat. The caller holds the plan row lock and has checked the
   * request is pending and the plan joinable.
   */
  private async acceptLocked(
    tx: Tx,
    plan: PlanRow,
    request: RequestRow,
    name: string,
  ): Promise<Effects> {
    if (plan.seatsTaken >= plan.seatsTotal) {
      throw err(HttpStatus.CONFLICT, 'plan_full', 'All seats on this plan are taken');
    }
    await this.assertSeatFor(tx, plan, request.requesterGender);
    await tx
      .update(planRequests)
      .set({ status: 'accepted', decidedAt: new Date() })
      .where(eq(planRequests.id, request.id));
    const [updated] = await tx
      .update(plans)
      .set({
        seatsTaken: sql`${plans.seatsTaken} + 1`,
        status: sql`case when ${plans.seatsTaken} + 1 >= ${plans.seatsTotal} then 'full'::plan_status else 'open'::plan_status end`,
        version: sql`${plans.version} + 1`,
      })
      .where(eq(plans.id, plan.id))
      .returning({ version: plans.version });
    const chat = await this.chat.join(
      tx,
      plan.id,
      plan.hostId,
      request.requesterId,
      `${name} joined the plan.`,
    );
    return { planId: plan.id, planVersion: updated!.version, chat };
  }

  /** Group plans with seats per gender: is one left for this gender? */
  private async assertSeatFor(tx: Tx, plan: PlanRow, gender: Gender) {
    if (!plan.genderMix) return;
    const allowed = plan.genderMix[gender] ?? 0;
    const [{ taken } = { taken: 0 }] = await tx
      .select({ taken: sql<number>`count(*)::int` })
      .from(planRequests)
      .where(
        and(
          eq(planRequests.planId, plan.id),
          eq(planRequests.status, 'accepted'),
          eq(planRequests.requesterGender, gender),
        ),
      );
    if (taken >= allowed) {
      throw err(
        HttpStatus.CONFLICT,
        'no_seat_for_gender',
        `The seats for ${GENDER_WORD[gender]} on this plan are taken`,
      );
    }
  }

  private assertJoinable(p: PlanRow) {
    if (p.status === 'cancelled' || p.status === 'completed') {
      throw err(HttpStatus.CONFLICT, 'plan_closed', 'This plan is no longer on');
    }
    if (p.startsAt.getTime() <= Date.now()) {
      throw err(HttpStatus.CONFLICT, 'plan_started', 'This plan has already started');
    }
    if (p.status === 'full' || p.seatsTaken >= p.seatsTotal) {
      throw err(HttpStatus.CONFLICT, 'plan_full', 'All seats on this plan are taken');
    }
  }

  private assertPending(r: RequestRow) {
    const status = effectiveStatus(r);
    if (status === 'expired') {
      throw err(HttpStatus.CONFLICT, 'request_expired', 'This request has expired');
    }
    if (status !== 'pending') {
      throw err(HttpStatus.CONFLICT, 'request_closed', `This request was already ${status}`);
    }
  }

  /** Loads a request and locks its plan, checking the caller hosts it. */
  private async lockForHost(tx: Tx, hostId: string, requestId: string) {
    const [found] = await tx
      .select({ planId: planRequests.planId })
      .from(planRequests)
      .where(eq(planRequests.id, requestId));
    if (!found) throw requestNotFound();
    const [plan] = await tx
      .select()
      .from(plans)
      .where(and(eq(plans.id, found.planId), eq(plans.hostId, hostId)))
      .for('update');
    if (!plan) throw requestNotFound();
    const [request] = await tx
      .select()
      .from(planRequests)
      .where(eq(planRequests.id, requestId))
      .for('update');
    return { plan, request: request! };
  }

  private async runEffects(e: Effects) {
    if (e.planVersion !== undefined) await this.plansService.enqueueIndex(e.planId, e.planVersion);
    await this.chat.broadcast(e.chat ?? null);
    for (const p of e.push ?? []) await this.notifier.push(p);
  }

  private async selectRequests(where: SQL, orderBy: SQL[]): Promise<PlanRequest[]> {
    const rows = await this.db
      .select({
        r: planRequests,
        profile: profiles,
        photoPrefixes: sql<string[]>`coalesce((
          select array_agg(${photos.publicPrefix} order by ${photos.position})
          from ${photos}
          where ${photos.userId} = ${planRequests.requesterId} and ${photos.status} = 'approved'
        ), '{}')`,
      })
      .from(planRequests)
      .innerJoin(profiles, eq(profiles.userId, planRequests.requesterId))
      .innerJoin(users, and(eq(users.id, planRequests.requesterId), eq(users.status, 'active')))
      .where(where)
      .orderBy(...orderBy)
      .limit(100);
    return rows.map(({ r, profile, photoPrefixes }) => ({
      id: r.id,
      planId: r.planId,
      status: effectiveStatus(r),
      message: r.message,
      skillLevel: r.skillLevel,
      score: r.score,
      reasons: r.scoreReasons,
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      requester: {
        userId: profile.userId,
        displayName: profile.displayName,
        age: ageOn(profile.birthDate),
        gender: profile.gender,
        verified: !!profile.verifiedAt,
        neighbourhood: profile.neighbourhood,
        bio: profile.bio,
        jobTitle: profile.jobTitle,
        interests: profile.interests,
        photoUrls: parsePgArray(photoPrefixes).map((prefix) =>
          this.storage.publicUrl(storageKeys.photoVariant(prefix, 'full')),
        ),
      },
    }));
  }
}

/** A pending request past its expiry reads as expired before the sweeper gets to it. */
function effectiveStatus(r: Pick<RequestRow, 'status' | 'expiresAt'>): RequestStatus {
  return r.status === 'pending' && r.expiresAt.getTime() <= Date.now() ? 'expired' : r.status;
}

/** node-postgres returns text[] as an array, but be tolerant of the literal form. */
function parsePgArray(v: string[] | string | null): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return v
    .replace(/^\{|\}$/g, '')
    .split(',')
    .filter(Boolean)
    .map((s) => s.replace(/^"|"$/g, ''));
}

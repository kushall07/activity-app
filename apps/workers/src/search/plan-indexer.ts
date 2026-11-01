import { Inject, Injectable, Logger } from '@nestjs/common';
import { activities, plans } from '@activity/db';
import {
  deleteEndedPlans,
  deletePlan,
  deletePlansByHost,
  ensurePlansIndex,
  indexPlan,
  isSearchable,
  toPlanDocument,
  type SearchClient,
} from '@activity/search';
import { eq, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../infra/database.js';

export const SEARCH_CLIENT = Symbol('SEARCH_CLIENT');
export const SEARCH_REPLICAS = Symbol('SEARCH_REPLICAS');

export type SyncResult = 'indexed' | 'deleted' | 'stale' | 'disabled';

/**
 * Makes a plan's search document match Postgres. Always reads the current row,
 * so it is idempotent and order-independent: running it twice, or for an old
 * job after a newer one, converges on the same state.
 */
@Injectable()
export class PlanIndexer {
  private readonly logger = new Logger(PlanIndexer.name);
  private ready: Promise<void> | null = null;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(SEARCH_CLIENT) private readonly client: SearchClient | null,
    @Inject(SEARCH_REPLICAS) private readonly replicas: number,
  ) {}

  get enabled(): boolean {
    return this.client !== null;
  }

  /** Creates the index on first use; retried on the next call if it failed. */
  ensureIndex(): Promise<void> {
    if (!this.client) return Promise.resolve();
    this.ready ??= ensurePlansIndex(this.client, this.replicas).catch((err: unknown) => {
      this.ready = null;
      throw err;
    });
    return this.ready;
  }

  async sync(planId: string): Promise<SyncResult> {
    if (!this.client) return 'disabled';
    await this.ensureIndex();
    const [row] = await this.db
      .select({
        id: plans.id,
        hostId: plans.hostId,
        activitySlug: plans.activitySlug,
        category: activities.category,
        lat: sql<number>`ST_Y(${plans.location}::geometry)::float8`,
        lng: sql<number>`ST_X(${plans.location}::geometry)::float8`,
        startsAt: plans.startsAt,
        durationMinutes: plans.durationMinutes,
        status: plans.status,
        seatsTotal: plans.seatsTotal,
        seatsTaken: plans.seatsTaken,
        wantedGenders: plans.wantedGenders,
        ageMin: plans.ageMin,
        ageMax: plans.ageMax,
        intent: plans.intent,
        verifiedOnly: plans.verifiedOnly,
        costPerPersonInr: plans.costPerPersonInr,
        skillLevel: plans.skillLevel,
        createdAt: plans.createdAt,
        version: plans.version,
      })
      .from(plans)
      .innerJoin(activities, eq(activities.slug, plans.activitySlug))
      .where(eq(plans.id, planId));

    if (!row) {
      // Deleted with its host's account.
      await deletePlan(this.client, planId);
      return 'deleted';
    }

    let result: SyncResult;
    if (isSearchable(row)) {
      result = await indexPlan(this.client, toPlanDocument(row), row.version);
    } else {
      // Cancelled, completed or over. Plans never come back from these states.
      await deletePlan(this.client, planId);
      result = 'deleted';
    }
    // Raw SQL so updated_at (the row's "last changed") is not bumped by bookkeeping.
    await this.db.execute(
      sql`update plans set indexed_version = greatest(indexed_version, ${row.version}) where id = ${planId}`,
    );
    this.logger.debug(`Plan ${planId} v${row.version}: ${result}`);
    return result;
  }

  async deleteHost(hostId: string): Promise<number> {
    if (!this.client) return 0;
    await this.ensureIndex();
    return deletePlansByHost(this.client, hostId);
  }

  async deleteEnded(before: Date): Promise<number> {
    if (!this.client) return 0;
    await this.ensureIndex();
    return deleteEndedPlans(this.client, before);
  }
}

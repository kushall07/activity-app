/**
 * Plan indexing against real Postgres and OpenSearch (docker compose / CI services).
 * Skipped when OPENSEARCH_URL is not set.
 */
import { randomUUID } from 'node:crypto';
import { plans, profiles, users } from '@activity/db';
import { createSearchClient, PLANS_ALIAS, type SearchClient } from '@activity/search';
import type { ConfigService } from '@nestjs/config';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../src/config/env.js';
import { createDb, createPool, type Database } from '../src/infra/database.js';
import { PlanIndexHandler } from '../src/jobs/plan-index.handler.js';
import { UserPurgeHandler } from '../src/jobs/user-purge.handler.js';
import { PlanIndexSweeper } from '../src/search/plan-index-sweeper.js';
import { PlanIndexer } from '../src/search/plan-indexer.js';
import { MemoryStore } from './fakes.js';

const OPENSEARCH_URL = process.env.OPENSEARCH_URL;

describe.skipIf(!OPENSEARCH_URL)('plan search indexing (e2e)', () => {
  const pool = createPool({
    DATABASE_URL:
      process.env.DATABASE_URL ?? 'postgres://activity:activity@localhost:5432/activity',
    DATABASE_POOL_MAX: 3,
    DATABASE_SSL: false,
  });
  const db: Database = createDb(pool);
  let client: SearchClient;
  let indexer: PlanIndexer;
  let hostId: string;

  const job = (planId: string) => ({
    type: 'plan.index',
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    payload: { planId },
  });

  async function getDoc(id: string) {
    await client.indices.refresh({ index: PLANS_ALIAS });
    try {
      const res = await client.get({ index: PLANS_ALIAS, id });
      return { version: res.body._version, source: res.body._source as Record<string, unknown> };
    } catch {
      return null;
    }
  }

  async function newPlan(startsInHours = 24) {
    const [row] = await db
      .insert(plans)
      .values({
        hostId,
        activitySlug: 'badminton',
        placeName: 'Test court',
        area: 'Koramangala',
        location: sql`ST_SetSRID(ST_MakePoint(77.6245, 12.9352), 4326)::geography` as never,
        startsAt: new Date(Date.now() + startsInHours * 3600_000),
        durationMinutes: 90,
        seatsTotal: 3,
        wantedGenders: ['woman', 'man'],
      })
      .returning();
    return row!;
  }

  const indexedVersion = async (id: string) =>
    (await db.select({ v: plans.indexedVersion }).from(plans).where(eq(plans.id, id)))[0]?.v;

  beforeAll(async () => {
    client = createSearchClient({ node: OPENSEARCH_URL!, auth: 'none', region: 'ap-south-1' });
    indexer = new PlanIndexer(db, client, 0);
    const [u] = await db
      .insert(users)
      .values({ phoneE164: `+9196${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` })
      .returning();
    hostId = u!.id;
    await db
      .insert(profiles)
      .values({ userId: hostId, displayName: 'Meera', birthDate: '1995-01-01', gender: 'woman' });
  });

  afterAll(async () => {
    await client?.close();
    await pool.end();
  });

  it('indexes a new plan with its version and marks it indexed', async () => {
    const plan = await newPlan();
    await new PlanIndexHandler(indexer).handle(job(plan.id));
    const doc = await getDoc(plan.id);
    expect(doc?.version).toBe(1);
    expect(doc?.source).toMatchObject({
      activity: 'badminton',
      category: 'sport',
      seats_open: 3,
      status: 'open',
      wanted_genders: ['woman', 'man'],
    });
    expect((doc?.source.location as { lat: number }).lat).toBeCloseTo(12.9352, 4);
    expect(await indexedVersion(plan.id)).toBe(1);
  });

  it('ignores an older version arriving after a newer one', async () => {
    const plan = await newPlan();
    await db
      .update(plans)
      .set({ seatsTotal: 5, version: sql`${plans.version} + 1` })
      .where(eq(plans.id, plan.id));
    await indexer.sync(plan.id);
    // Simulate a stale writer: the document must stay at v2.
    const { indexPlan, toPlanDocument } = await import('@activity/search');
    const stale = await indexPlan(
      client,
      toPlanDocument({
        ...plan,
        category: 'sport',
        lat: 12.9,
        lng: 77.6,
        wantedGenders: plan.wantedGenders,
      }),
      1,
    );
    expect(stale).toBe('stale');
    expect((await getDoc(plan.id))?.source.seats_open).toBe(5);
  });

  it('removes cancelled plans from the index', async () => {
    const plan = await newPlan();
    await indexer.sync(plan.id);
    await db
      .update(plans)
      .set({ status: 'cancelled', version: sql`${plans.version} + 1` })
      .where(eq(plans.id, plan.id));
    await indexer.sync(plan.id);
    expect(await getDoc(plan.id)).toBeNull();
    expect(await indexedVersion(plan.id)).toBe(2);
  });

  it('the sweeper indexes plans whose job was lost', async () => {
    const plan = await newPlan();
    const config = { get: () => 30 } as unknown as ConfigService<Env, true>;
    const synced = await new PlanIndexSweeper(db, indexer, config).sweep();
    expect(synced).toBeGreaterThanOrEqual(1);
    expect(await getDoc(plan.id)).not.toBeNull();
    expect(await indexedVersion(plan.id)).toBe(1);
  });

  it('account deletion removes the host’s documents', async () => {
    const plan = await newPlan();
    await indexer.sync(plan.id);
    await new UserPurgeHandler(new MemoryStore(), indexer).handle({
      type: 'user.purge',
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      payload: { userId: hostId },
    });
    expect(await getDoc(plan.id)).toBeNull();
  });
});

import type { SearchClient } from './client.js';
import { statusOf } from './client.js';

/**
 * Reads and writes go through the alias, so a mapping change is a new
 * versioned index plus an alias swap, with no downtime.
 */
export const PLANS_ALIAS = 'plans';
export const PLANS_INDEX = 'plans-v1';

/**
 * Only what the feed filters and sorts on. The feed returns plan ids and then
 * reads the plans from Postgres, so profile edits never need a reindex and a
 * stale document can never show stale details.
 */
export interface PlanDocument {
  id: string;
  host_id: string;
  activity: string;
  category: string;
  location: { lat: number; lon: number };
  starts_at: string;
  ends_at: string;
  status: string;
  seats_open: number;
  wanted_genders: string[];
  age_min: number;
  age_max: number;
  intent: string;
  verified_only: boolean;
  cost_per_person: number | null;
  skill_level: string;
  created_at: string;
}

export const plansIndexBody = {
  settings: {
    // Small index (thousands of upcoming plans): one shard, one replica per extra node.
    number_of_shards: 1,
    'index.refresh_interval': '1s',
  },
  mappings: {
    dynamic: 'strict',
    properties: {
      id: { type: 'keyword' },
      host_id: { type: 'keyword' },
      activity: { type: 'keyword' },
      category: { type: 'keyword' },
      location: { type: 'geo_point' },
      starts_at: { type: 'date' },
      ends_at: { type: 'date' },
      status: { type: 'keyword' },
      seats_open: { type: 'short' },
      wanted_genders: { type: 'keyword' },
      age_min: { type: 'short' },
      age_max: { type: 'short' },
      intent: { type: 'keyword' },
      verified_only: { type: 'boolean' },
      cost_per_person: { type: 'integer' },
      skill_level: { type: 'keyword' },
      created_at: { type: 'date' },
    },
  },
} as const;

/** Creates the versioned index and alias if missing. Safe to call concurrently. */
export async function ensurePlansIndex(client: SearchClient, replicas = 1): Promise<void> {
  const exists = await client.indices.existsAlias({ name: PLANS_ALIAS });
  if (exists.body) return;
  try {
    await client.indices.create({
      index: PLANS_INDEX,
      body: {
        ...plansIndexBody,
        settings: { ...plansIndexBody.settings, number_of_replicas: replicas },
        aliases: { [PLANS_ALIAS]: {} },
      } as never,
    });
  } catch (err) {
    // Another task created it first.
    if (statusOf(err) !== 400) throw err;
    const raced = await client.indices.existsAlias({ name: PLANS_ALIAS });
    if (!raced.body) throw err;
  }
}

export type IndexResult = 'indexed' | 'stale';

/**
 * Writes with external versioning: a write carrying an older version than the
 * stored document is rejected (409), so out-of-order jobs cannot regress it.
 */
export async function indexPlan(
  client: SearchClient,
  doc: PlanDocument,
  version: number,
): Promise<IndexResult> {
  try {
    await client.index({
      index: PLANS_ALIAS,
      id: doc.id,
      body: doc as never,
      version,
      version_type: 'external_gte',
    });
    return 'indexed';
  } catch (err) {
    if (statusOf(err) === 409) return 'stale';
    throw err;
  }
}

/** Removes a plan from search. Missing documents are fine (already gone). */
export async function deletePlan(client: SearchClient, id: string): Promise<void> {
  try {
    await client.delete({ index: PLANS_ALIAS, id });
  } catch (err) {
    if (statusOf(err) !== 404) throw err;
  }
}

export async function deletePlansByHost(client: SearchClient, hostId: string): Promise<number> {
  // Rare (account deletion): refresh first so documents indexed in the last second are seen.
  await client.indices.refresh({ index: PLANS_ALIAS });
  const res = await client.deleteByQuery({
    index: PLANS_ALIAS,
    body: { query: { term: { host_id: hostId } } } as never,
    conflicts: 'proceed',
    refresh: true,
  });
  return Number((res.body as { deleted?: number }).deleted ?? 0);
}

/** Housekeeping: plans that ended before `before` never show in the feed again. */
export async function deleteEndedPlans(client: SearchClient, before: Date): Promise<number> {
  const res = await client.deleteByQuery({
    index: PLANS_ALIAS,
    body: { query: { range: { ends_at: { lt: before.toISOString() } } } } as never,
    conflicts: 'proceed',
  });
  return Number((res.body as { deleted?: number }).deleted ?? 0);
}

export interface PlanRowForIndex {
  id: string;
  hostId: string;
  activitySlug: string;
  category: string;
  lat: number;
  lng: number;
  startsAt: Date;
  durationMinutes: number;
  status: string;
  seatsTotal: number;
  seatsTaken: number;
  wantedGenders: string[];
  ageMin: number;
  ageMax: number;
  intent: string;
  verifiedOnly: boolean;
  costPerPersonInr: number | null;
  skillLevel: string;
  createdAt: Date;
}

export function toPlanDocument(row: PlanRowForIndex): PlanDocument {
  return {
    id: row.id,
    host_id: row.hostId,
    activity: row.activitySlug,
    category: row.category,
    location: { lat: row.lat, lon: row.lng },
    starts_at: row.startsAt.toISOString(),
    ends_at: new Date(row.startsAt.getTime() + row.durationMinutes * 60_000).toISOString(),
    status: row.status,
    seats_open: Math.max(row.seatsTotal - row.seatsTaken, 0),
    wanted_genders: row.wantedGenders,
    age_min: row.ageMin,
    age_max: row.ageMax,
    intent: row.intent,
    verified_only: row.verifiedOnly,
    cost_per_person: row.costPerPersonInr,
    skill_level: row.skillLevel,
    created_at: row.createdAt.toISOString(),
  };
}

/** Plans worth keeping in the index: not cancelled or completed, and not over yet. */
export function isSearchable(
  row: Pick<PlanRowForIndex, 'status' | 'startsAt' | 'durationMinutes'>,
  now = new Date(),
) {
  const endsAt = row.startsAt.getTime() + row.durationMinutes * 60_000;
  return (row.status === 'open' || row.status === 'full') && endsAt > now.getTime();
}

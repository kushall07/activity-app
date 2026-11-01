/** Who is looking: hard filters every plan must pass for this viewer. */
export interface FeedViewer {
  userId: string;
  gender: string;
  age: number;
  verified: boolean;
}

/** Keyset position after the last item of the previous page. */
export type FeedCursor =
  | { sort: 'soonest'; startsAtMs: number; id: string }
  | { sort: 'nearest'; distanceM: number; id: string };

export interface FeedFilters {
  lat: number;
  lng: number;
  radiusKm: number;
  activities?: string[];
  categories?: string[];
  from?: Date;
  to?: Date;
  /** Already expanded: e.g. ['date', 'either'] for a viewer who wants a date. */
  intents?: string[];
  maxCostInr?: number;
  sort: 'soonest' | 'nearest';
  /** Page size + 1, so the caller can tell whether there is a next page. */
  size: number;
  cursor?: FeedCursor;
  now: Date;
}

/**
 * The OpenSearch request for the Explore feed. Mirrors the Postgres fallback
 * query in the API exactly; the e2e tests run the same cases against both.
 */
export function buildFeedSearch(viewer: FeedViewer, f: FeedFilters) {
  const filter: unknown[] = [
    { term: { status: 'open' } },
    { range: { starts_at: { gt: f.now.toISOString() } } },
    { range: { seats_open: { gt: 0 } } },
    { geo_distance: { distance: `${f.radiusKm}km`, location: { lat: f.lat, lon: f.lng } } },
    { term: { wanted_genders: viewer.gender } },
    { range: { age_min: { lte: viewer.age } } },
    { range: { age_max: { gte: viewer.age } } },
  ];
  const mustNot: unknown[] = [{ term: { host_id: viewer.userId } }];
  if (!viewer.verified) mustNot.push({ term: { verified_only: true } });

  if (f.activities?.length) filter.push({ terms: { activity: f.activities } });
  if (f.categories?.length) filter.push({ terms: { category: f.categories } });
  if (f.intents?.length) filter.push({ terms: { intent: f.intents } });
  if (f.from || f.to) {
    filter.push({
      range: {
        starts_at: {
          ...(f.from ? { gte: f.from.toISOString() } : {}),
          ...(f.to ? { lte: f.to.toISOString() } : {}),
        },
      },
    });
  }
  if (f.maxCostInr !== undefined) {
    // A plan with no stated cost is not excluded by a budget.
    filter.push({
      bool: {
        should: [
          { range: { cost_per_person: { lte: f.maxCostInr } } },
          { bool: { must_not: { exists: { field: 'cost_per_person' } } } },
        ],
        minimum_should_match: 1,
      },
    });
  }

  const sort =
    f.sort === 'soonest'
      ? [{ starts_at: { order: 'asc' } }, { id: { order: 'asc' } }]
      : [
          {
            _geo_distance: {
              location: { lat: f.lat, lon: f.lng },
              order: 'asc',
              unit: 'm',
              distance_type: 'arc',
            },
          },
          { id: { order: 'asc' } },
        ];

  let searchAfter: (string | number)[] | undefined;
  if (f.cursor?.sort === 'soonest' && f.sort === 'soonest') {
    searchAfter = [f.cursor.startsAtMs, f.cursor.id];
  } else if (f.cursor?.sort === 'nearest' && f.sort === 'nearest') {
    searchAfter = [f.cursor.distanceM, f.cursor.id];
  }

  return {
    size: f.size,
    _source: false,
    track_total_hits: false,
    query: { bool: { filter, must_not: mustNot } },
    sort,
    ...(searchAfter ? { search_after: searchAfter } : {}),
  };
}

export interface FeedHit {
  id: string;
  sort: (string | number)[];
}

export function parseFeedHits(body: unknown): FeedHit[] {
  const hits = (body as { hits?: { hits?: { _id: string; sort?: (string | number)[] }[] } }).hits
    ?.hits;
  return (hits ?? []).map((h) => ({ id: h._id, sort: h.sort ?? [] }));
}

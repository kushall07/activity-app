import { describe, expect, it } from 'vitest';
import { buildFeedSearch, type FeedFilters } from './feed-query.js';
import { isSearchable, toPlanDocument } from './plans-index.js';

const viewer = { userId: 'u1', gender: 'woman', age: 29, verified: false };
const base: FeedFilters = {
  lat: 12.97,
  lng: 77.64,
  radiusKm: 10,
  sort: 'soonest',
  size: 21,
  now: new Date('2030-01-01T00:00:00Z'),
};

describe('buildFeedSearch', () => {
  it('applies the hard filters for the viewer', () => {
    const q = buildFeedSearch(viewer, base);
    expect(q.query.bool.filter).toEqual(
      expect.arrayContaining([
        { term: { status: 'open' } },
        { range: { starts_at: { gt: '2030-01-01T00:00:00.000Z' } } },
        { geo_distance: { distance: '10km', location: { lat: 12.97, lon: 77.64 } } },
        { term: { wanted_genders: 'woman' } },
        { range: { age_min: { lte: 29 } } },
        { range: { age_max: { gte: 29 } } },
      ]),
    );
    expect(q.query.bool.must_not).toEqual([
      { term: { host_id: 'u1' } },
      { term: { verified_only: true } },
    ]);
    expect(q._source).toBe(false);
  });

  it('lets verified viewers see verified-only plans', () => {
    const q = buildFeedSearch({ ...viewer, verified: true }, base);
    expect(q.query.bool.must_not).toEqual([{ term: { host_id: 'u1' } }]);
  });

  it('adds optional filters and keeps plans without a stated cost in budget', () => {
    const q = buildFeedSearch(viewer, {
      ...base,
      activities: ['badminton'],
      categories: ['sport'],
      intents: ['date', 'either'],
      from: new Date('2030-01-02T00:00:00Z'),
      maxCostInr: 500,
    });
    const filter = q.query.bool.filter;
    expect(filter).toContainEqual({ terms: { activity: ['badminton'] } });
    expect(filter).toContainEqual({ terms: { category: ['sport'] } });
    expect(filter).toContainEqual({ terms: { intent: ['date', 'either'] } });
    expect(filter).toContainEqual({ range: { starts_at: { gte: '2030-01-02T00:00:00.000Z' } } });
    expect(JSON.stringify(filter)).toContain('"must_not":{"exists":{"field":"cost_per_person"}}');
  });

  it('continues after the cursor for the matching sort only', () => {
    const soonest = buildFeedSearch(viewer, {
      ...base,
      cursor: { sort: 'soonest', startsAtMs: 123, id: 'p1' },
    });
    expect(soonest.search_after).toEqual([123, 'p1']);
    expect(soonest.sort[0]).toEqual({ starts_at: { order: 'asc' } });

    const nearest = buildFeedSearch(viewer, {
      ...base,
      sort: 'nearest',
      cursor: { sort: 'nearest', distanceM: 42.5, id: 'p1' },
    });
    expect(nearest.search_after).toEqual([42.5, 'p1']);
    expect(Object.keys(nearest.sort[0]!)).toEqual(['_geo_distance']);
  });
});

describe('plan documents', () => {
  const row = {
    id: 'p1',
    hostId: 'h1',
    activitySlug: 'badminton',
    category: 'sport',
    lat: 12.9,
    lng: 77.6,
    startsAt: new Date('2030-01-01T10:00:00Z'),
    durationMinutes: 90,
    status: 'open',
    seatsTotal: 3,
    seatsTaken: 1,
    wantedGenders: ['woman'],
    ageMin: 18,
    ageMax: 40,
    intent: 'either',
    verifiedOnly: false,
    costPerPersonInr: null,
    skillLevel: 'any',
    createdAt: new Date('2029-12-30T10:00:00Z'),
  };

  it('maps a row to the index document', () => {
    expect(toPlanDocument(row)).toMatchObject({
      location: { lat: 12.9, lon: 77.6 },
      ends_at: '2030-01-01T11:30:00.000Z',
      seats_open: 2,
      cost_per_person: null,
    });
  });

  it('keeps only live plans in the index', () => {
    const before = new Date('2030-01-01T11:00:00Z');
    const after = new Date('2030-01-01T12:00:00Z');
    expect(isSearchable(row, before)).toBe(true);
    expect(isSearchable(row, after)).toBe(false);
    expect(isSearchable({ ...row, status: 'cancelled' }, before)).toBe(false);
  });
});

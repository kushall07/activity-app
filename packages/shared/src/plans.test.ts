import { describe, expect, it } from 'vitest';
import { containsContactDetails, createPlanRequestSchema, feedQuerySchema } from './plans.js';

const valid = {
  activitySlug: 'badminton',
  place: { name: 'Community court', area: 'Koramangala' },
  startsAt: '2030-01-01T13:30:00.000Z',
  seatsTotal: 3,
  wantedGenders: ['woman', 'man', 'woman'],
};

const firstError = (input: unknown) =>
  createPlanRequestSchema.safeParse(input).error?.issues[0]?.message;

describe('createPlanRequestSchema', () => {
  it('applies defaults and de-duplicates genders', () => {
    const plan = createPlanRequestSchema.parse(valid);
    expect(plan).toMatchObject({
      durationMinutes: 120,
      ageMin: 18,
      ageMax: 100,
      skillLevel: 'any',
      intent: 'either',
      costSplit: 'each_pays_own',
      verifiedOnly: false,
      note: '',
      wantedGenders: ['woman', 'man'],
    });
  });

  it('needs exactly one of a venue or a place', () => {
    expect(firstError({ ...valid, place: undefined })).toMatch(/venue or name a place/);
    expect(firstError({ ...valid, venueId: '0b5c6a7d-1e2f-4a3b-8c9d-0e1f2a3b4c5d' })).toMatch(
      /venue or name a place/,
    );
  });

  it('checks ages, gender mix and cost', () => {
    expect(firstError({ ...valid, ageMin: 40, ageMax: 30 })).toMatch(/upside down/);
    expect(firstError({ ...valid, genderMix: { woman: 1, man: 1 } })).toMatch(/add up/);
    expect(firstError({ ...valid, genderMix: { woman: 2, nonbinary: 1 } })).toMatch(
      /genders you chose/,
    );
    expect(firstError({ ...valid, costSplit: 'free', costPerPersonInr: 100 })).toMatch(/free plan/);
  });

  it('keeps pins inside Bengaluru', () => {
    expect(firstError({ ...valid, place: { ...valid.place, lat: 19.07, lng: 72.87 } })).toMatch(
      /Bengaluru/,
    );
    expect(firstError({ ...valid, place: { ...valid.place, lat: 12.97 } })).toMatch(/both/);
  });
});

describe('containsContactDetails', () => {
  it.each([
    'call me 9876543210',
    'ping +91 98765 43210',
    'mail a.b@example.com',
    'insta @badminton.bro',
  ])('flags %s', (text) => expect(containsContactDetails(text)).toBe(true));

  it.each(['Court 3, 7 pm', 'Bring 2 rackets and ₹300', 'Meet @ the gate'])('allows %s', (text) =>
    expect(containsContactDetails(text)).toBe(false),
  );
});

describe('feedQuerySchema', () => {
  it('parses query strings', () => {
    const q = feedQuerySchema.parse({
      lat: '12.97',
      lng: '77.64',
      categories: 'sport,show',
      maxCostInr: '500',
    });
    expect(q).toMatchObject({
      lat: 12.97,
      radiusKm: 10,
      categories: ['sport', 'show'],
      maxCostInr: 500,
      sort: 'soonest',
      limit: 20,
    });
  });

  it('rejects an inverted time window', () => {
    expect(
      feedQuerySchema.safeParse({
        lat: 1,
        lng: 1,
        from: '2030-01-02T00:00:00Z',
        to: '2030-01-01T00:00:00Z',
      }).success,
    ).toBe(false);
  });
});

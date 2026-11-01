import { describe, expect, it } from 'vitest';
import { haversineKm, scoreRequest, type ScorePlan, type ScoreRequester } from './score.js';

const now = new Date('2026-11-01T12:00:00Z');
const koramangala = { lat: 12.9352, lng: 77.6245 };

const plan: ScorePlan = {
  activitySlug: 'table-tennis',
  activityName: 'Table tennis',
  ...koramangala,
  skillLevel: 'intermediate',
  intent: 'friends',
};

const member = (o: Partial<ScoreRequester> = {}): ScoreRequester => ({
  neighbourhood: 'Koramangala',
  interests: ['table tennis', 'coffee'],
  intent: 'friends',
  verified: true,
  skillLevel: 'intermediate',
  joinedAt: new Date('2026-01-01T00:00:00Z'),
  ...o,
});

describe('scoreRequest', () => {
  it('gives a near-perfect match a high score with readable reasons', () => {
    const { score, reasons } = scoreRequest(plan, member(), now);
    expect(score).toBeGreaterThanOrEqual(90);
    expect(reasons).toEqual([
      'Lives nearby (Koramangala)',
      'Also intermediate',
      'Into table tennis',
    ]);
  });

  it('ranks a closer, same-level, verified member above a far, mismatched one', () => {
    const good = scoreRequest(plan, member(), now).score;
    const poor = scoreRequest(
      plan,
      member({
        neighbourhood: 'Yelahanka',
        skillLevel: 'beginner',
        interests: [],
        verified: false,
        intent: 'date',
      }),
      now,
    ).score;
    expect(good).toBeGreaterThan(poor + 40);
  });

  it('treats a level gap of two as no fit and an unknown area as neutral', () => {
    const a = scoreRequest(plan, member({ skillLevel: 'advanced' }), now).score;
    const b = scoreRequest(plan, member({ skillLevel: 'beginner' }), now).score;
    expect(a).toBe(b);
    const unknown = scoreRequest(plan, member({ neighbourhood: 'Somewhere else' }), now);
    expect(unknown.reasons).not.toContain('Lives nearby (Koramangala)');
  });

  it('boosts members who joined in the last two weeks', () => {
    const veteran = scoreRequest(plan, member(), now).score;
    const fresh = scoreRequest(plan, member({ joinedAt: new Date('2026-10-28T00:00:00Z') }), now);
    expect(fresh.score).toBeGreaterThan(veteran);
  });

  it('stays within 0-100', () => {
    const worst = scoreRequest(
      { ...plan, intent: 'date' },
      member({
        neighbourhood: 'Yelahanka',
        skillLevel: 'beginner',
        interests: [],
        verified: false,
        intent: 'friends',
      }),
      now,
    );
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.score).toBeLessThan(30);
    expect(worst.reasons).toEqual([]);
  });
});

describe('haversineKm', () => {
  it('measures Koramangala to Indiranagar at about 5 km', () => {
    expect(haversineKm(koramangala, { lat: 12.9719, lng: 77.6412 })).toBeCloseTo(4.5, 0);
  });
});

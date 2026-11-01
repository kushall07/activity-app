import { describe, expect, it } from 'vitest';
import { normalizePhone } from './phone.js';
import { ageOn, upsertProfileRequestSchema } from './profile.js';

describe('normalizePhone', () => {
  it('normalises Indian mobile numbers to E.164', () => {
    expect(normalizePhone('98765 43210')).toBe('+919876543210');
    expect(normalizePhone('+91 98765-43210')).toBe('+919876543210');
    expect(normalizePhone('09876543210')).toBe('+919876543210');
  });

  it('rejects junk and short numbers', () => {
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('hello')).toBeNull();
  });
});

describe('ageOn', () => {
  it('counts whole years, birthday-aware', () => {
    const today = new Date('2026-11-01T00:00:00Z');
    expect(ageOn('2008-11-01', today)).toBe(18);
    expect(ageOn('2008-11-02', today)).toBe(17);
  });
});

describe('upsertProfileRequestSchema', () => {
  const valid = { displayName: ' Ananya ', birthDate: '1996-04-12', gender: 'woman' };

  it('trims, defaults and de-duplicates interests', () => {
    const parsed = upsertProfileRequestSchema.parse({
      ...valid,
      interests: ['Badminton', 'badminton', ' Comedy '],
      jobTitle: '',
    });
    expect(parsed).toMatchObject({
      displayName: 'Ananya',
      intent: 'either',
      bio: '',
      jobTitle: null,
      interests: ['badminton', 'comedy'],
    });
  });

  it('rejects minors, impossible dates and long bios', () => {
    const minor = `${new Date().getUTCFullYear() - 16}-01-01`;
    expect(upsertProfileRequestSchema.safeParse({ ...valid, birthDate: minor }).success).toBe(
      false,
    );
    expect(
      upsertProfileRequestSchema.safeParse({ ...valid, birthDate: '1996-02-30' }).success,
    ).toBe(false);
    expect(upsertProfileRequestSchema.safeParse({ ...valid, bio: 'x'.repeat(301) }).success).toBe(
      false,
    );
  });
});

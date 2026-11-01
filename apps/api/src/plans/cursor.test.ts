import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor.js';

const id = '0b5c6a7d-1e2f-4a3b-8c9d-0e1f2a3b4c5d';

describe('feed cursor', () => {
  it('round-trips both sort orders', () => {
    const soonest = { sort: 'soonest' as const, startsAtMs: 1_900_000_000_000, id };
    expect(decodeCursor(encodeCursor(soonest), 'soonest')).toEqual(soonest);
    const nearest = { sort: 'nearest' as const, distanceM: 1234.5678, id };
    expect(decodeCursor(encodeCursor(nearest), 'nearest')).toEqual({
      ...nearest,
      distanceM: 1234.568,
    });
  });

  it('rejects garbage and a cursor from the other sort', () => {
    expect(() => decodeCursor('nope', 'soonest')).toThrow('Invalid cursor');
    const c = encodeCursor({ sort: 'soonest', startsAtMs: 1, id });
    expect(() => decodeCursor(c, 'nearest')).toThrow(/different sort/);
  });
});

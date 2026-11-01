import {
  atIstMinutes,
  formatCost,
  formatDay,
  formatDistance,
  formatSeats,
  formatWhen,
  formatWho,
  istDayStart,
  whenRange,
} from './planFormat';

// Friday 1 Nov 2030, 20:00 IST (14:30 UTC).
const now = new Date('2030-11-01T14:30:00Z');

describe('plan formatting (always IST)', () => {
  it('finds the IST day start, even just after midnight IST', () => {
    expect(istDayStart(now).toISOString()).toBe('2030-10-31T18:30:00.000Z');
    // 00:15 IST on 2 Nov is still 1 Nov in UTC.
    expect(istDayStart(new Date('2030-11-01T18:45:00Z')).toISOString()).toBe(
      '2030-11-01T18:30:00.000Z',
    );
  });

  it('formats days and times', () => {
    expect(formatWhen('2030-11-01T15:30:00Z', now)).toBe('Today, 9:00 pm');
    expect(formatWhen('2030-11-02T01:30:00Z', now)).toBe('Tomorrow, 7:00 am');
    expect(formatDay(new Date('2030-11-05T06:30:00Z'), now)).toBe('Tue 5 Nov');
    expect(atIstMinutes(now, 19 * 60).toISOString()).toBe('2030-11-01T13:30:00.000Z');
  });

  it('describes who and how many', () => {
    const seats = { total: 2, taken: 0, open: 2 };
    expect(formatWho({ seats, wantedGenders: ['woman'], genderMix: null })).toBe('2 women');
    expect(formatWho({ seats, wantedGenders: ['woman', 'man'], genderMix: null })).toBe('2 people');
    expect(
      formatWho({ seats, wantedGenders: ['woman', 'man'], genderMix: { woman: 1, man: 1 } }),
    ).toBe('1 woman, 1 man');
    expect(formatSeats({ seats: { total: 3, taken: 1, open: 2 } })).toBe('2 of 3 left');
    expect(formatSeats({ seats: { total: 1, taken: 1, open: 0 } })).toBe('Full');
  });

  it('describes cost and distance', () => {
    expect(formatCost({ costSplit: 'split_equally', costPerPersonInr: 1200 })).toBe(
      'Split equally · ₹1,200 each',
    );
    expect(formatCost({ costSplit: 'free', costPerPersonInr: 0 })).toBe('Free');
    expect(formatDistance(0.4)).toBe('400 m');
    expect(formatDistance(3.25)).toBe('3.3 km');
    expect(formatDistance(null)).toBeNull();
  });

  it('turns "when" chips into IST ranges', () => {
    expect(whenRange('any', now)).toEqual({});
    expect(whenRange('tomorrow', now)).toEqual({
      from: '2030-11-01T18:30:00.000Z',
      to: '2030-11-02T18:29:59.999Z',
    });
    // Friday -> Saturday 00:00 IST to Sunday 23:59 IST.
    expect(whenRange('weekend', now)).toEqual({
      from: '2030-11-01T18:30:00.000Z',
      to: '2030-11-03T18:29:59.999Z',
    });
  });
});

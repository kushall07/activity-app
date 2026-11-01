import { formatIndianDate, parseIndianDate } from './dates';

describe('parseIndianDate', () => {
  it('reads DD/MM/YYYY with common separators', () => {
    expect(parseIndianDate('12/04/1996')).toBe('1996-04-12');
    expect(parseIndianDate('1-4-1996')).toBe('1996-04-01');
    expect(parseIndianDate(' 01.12.2000 ')).toBe('2000-12-01');
  });

  it('rejects impossible or malformed dates', () => {
    expect(parseIndianDate('31/02/1996')).toBeNull();
    expect(parseIndianDate('1996-04-12')).toBeNull();
    expect(parseIndianDate('')).toBeNull();
  });

  it('round-trips with formatIndianDate', () => {
    expect(formatIndianDate('1996-04-12')).toBe('12/04/1996');
  });
});

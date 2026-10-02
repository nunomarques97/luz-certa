import { lisbonOffsetMinutes, toLisbonLocal, utcCandidatesForIntervalEnd } from './lisbon-time';

const intlOffset = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', timeZoneName: 'shortOffset' });

function offsetFromIntl(utcMs: number): number {
  const name = intlOffset.formatToParts(new Date(utcMs)).find((p) => p.type === 'timeZoneName')?.value ?? '';
  return name === 'GMT+1' ? 60 : 0;
}

describe('Lisbon time', () => {
  it('matches the platform time zone database for every hour from 2024 to 2026', () => {
    for (const year of [2024, 2025, 2026]) {
      for (let utc = Date.UTC(year, 0, 1); utc < Date.UTC(year + 1, 0, 1); utc += 3_600_000) {
        expect(lisbonOffsetMinutes(utc)).toBe(offsetFromIntl(utc));
      }
    }
  });

  it('switches at 01:00 UTC on the last Sundays of March and October 2025', () => {
    expect(lisbonOffsetMinutes(Date.UTC(2025, 2, 30, 0, 59))).toBe(0);
    expect(lisbonOffsetMinutes(Date.UTC(2025, 2, 30, 1, 0))).toBe(60);
    expect(lisbonOffsetMinutes(Date.UTC(2025, 9, 26, 0, 59))).toBe(60);
    expect(lisbonOffsetMinutes(Date.UTC(2025, 9, 26, 1, 0))).toBe(0);
  });

  it('formats local time with its offset', () => {
    expect(toLisbonLocal(Date.UTC(2025, 6, 1, 11, 15)).iso).toBe('2025-07-01T12:15+01:00');
    expect(toLisbonLocal(Date.UTC(2025, 0, 1, 0, 0))).toEqual({
      date: '2025-01-01',
      minuteOfDay: 0,
      offsetMinutes: 0,
      iso: '2025-01-01T00:00+00:00',
    });
  });

  it('resolves interval-end labels on DST days', () => {
    const wall = (h: number, m: number, month = 2, day = 30) => Date.UTC(2025, month, day, h, m);
    // Spring: 01:00 closes the last winter quarter; 02:00 is accepted as the same instant.
    expect(utcCandidatesForIntervalEnd(wall(1, 0))).toEqual([Date.UTC(2025, 2, 30, 1, 0)]);
    expect(utcCandidatesForIntervalEnd(wall(2, 0))).toEqual([Date.UTC(2025, 2, 30, 1, 0)]);
    expect(utcCandidatesForIntervalEnd(wall(1, 30))).toEqual([]);
    expect(utcCandidatesForIntervalEnd(wall(2, 15))).toEqual([Date.UTC(2025, 2, 30, 1, 15)]);
    // Autumn: 01:15 to 02:00 occur twice.
    expect(utcCandidatesForIntervalEnd(wall(1, 15, 9, 26))).toEqual([Date.UTC(2025, 9, 26, 0, 15), Date.UTC(2025, 9, 26, 1, 15)]);
    expect(utcCandidatesForIntervalEnd(wall(2, 0, 9, 26))).toEqual([Date.UTC(2025, 9, 26, 1, 0), Date.UTC(2025, 9, 26, 2, 0)]);
    expect(utcCandidatesForIntervalEnd(wall(1, 0, 9, 26))).toEqual([Date.UTC(2025, 9, 26, 0, 0)]);
  });
});

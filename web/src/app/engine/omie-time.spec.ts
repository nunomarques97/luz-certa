import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildOmieFiles, lisbonToUtc, madridWallIntl } from '../../testing/engine-fixtures';
import { QUARTER_HOUR_MS } from './lisbon-time';
import {
  OmiePriceLookup,
  OmieYearFile,
  marketDayMinutes,
  marketDayOf,
  omieMarketPeriod,
} from './omie-time';

describe('OMIE market time', () => {
  it('matches the Spanish date of the time zone database for every quarter-hour of 2024 to 2026', () => {
    const from = Date.UTC(2023, 11, 31, 22);
    const to = Date.UTC(2027, 0, 1);
    let checked = 0;
    for (let utc = from; utc < to; utc += QUARTER_HOUR_MS) {
      // Clock changes and midnights are where a wrong offset shows; sample those densely, the rest hourly.
      const wall = madridWallIntl(utc);
      expect(marketDayOf(utc), wall).toBe(wall.slice(0, 10));
      checked++;
      if (!/T(2[2-3]|0[0-3]):/.test(wall)) {
        utc += 3 * QUARTER_HOUR_MS;
      }
    }
    expect(checked).toBeGreaterThan(30_000);
  });

  it.each([
    // Day boundary: Lisbon 23:00 is Spanish midnight, so it opens the next market day.
    ['2025-01-01T22:45', 'first', 60, '2025-01-01', 24],
    ['2025-01-01T23:00', 'first', 60, '2025-01-02', 1],
    ['2025-01-01T00:00', 'first', 60, '2025-01-01', 2],
    // Spring clock change (23-hour market day): Spanish 02:00 to 03:00 does not exist.
    ['2025-03-30T00:45', 'first', 60, '2025-03-30', 2],
    ['2025-03-30T02:00', 'first', 60, '2025-03-30', 3],
    ['2025-03-30T22:45', 'first', 60, '2025-03-30', 23],
    ['2025-03-30T23:00', 'first', 60, '2025-03-31', 1],
    // Autumn clock change, hourly (25-hour market day): Spanish 02:00 occurs twice.
    ['2024-10-27T01:00', 'first', 60, '2024-10-27', 3],
    ['2024-10-27T01:00', 'second', 60, '2024-10-27', 4],
    ['2024-10-27T22:00', 'first', 60, '2024-10-27', 25],
    // Switch to quarter-hourly prices on market day 2025-10-01.
    ['2025-09-30T22:45', 'first', 60, '2025-09-30', 24],
    ['2025-09-30T23:00', 'first', 15, '2025-10-01', 1],
    ['2025-09-30T23:15', 'first', 15, '2025-10-01', 2],
    ['2025-10-01T00:00', 'first', 15, '2025-10-01', 5],
    // Autumn clock change, quarter-hourly (100 periods).
    ['2025-10-26T00:00', 'first', 15, '2025-10-26', 5],
    ['2025-10-26T01:00', 'first', 15, '2025-10-26', 9],
    ['2025-10-26T01:00', 'second', 15, '2025-10-26', 13],
    ['2025-10-26T22:45', 'first', 15, '2025-10-26', 100],
    ['2025-10-26T23:00', 'first', 15, '2025-10-27', 1],
    // Spring clock change, quarter-hourly (92 periods).
    ['2026-03-29T02:00', 'first', 15, '2026-03-29', 9],
    ['2026-03-29T22:45', 'first', 15, '2026-03-29', 92],
  ] as const)(
    'maps Lisbon %s (%s) at %i min to market day %s period %i',
    (wall, occurrence, res, day, period) => {
      expect(omieMarketPeriod(lisbonToUtc(wall, occurrence), res)).toEqual({
        marketDay: day,
        period,
      });
    },
  );

  it('knows the length of clock-change market days', () => {
    expect(marketDayMinutes('2025-01-01')).toBe(1440);
    expect(marketDayMinutes('2025-03-30')).toBe(1380);
    expect(marketDayMinutes('2025-10-26')).toBe(1500);
    expect(marketDayMinutes('2024-10-27')).toBe(1500);
    expect(marketDayMinutes('2026-03-29')).toBe(1380);
  });
});

describe('OmiePriceLookup', () => {
  const files = buildOmieFiles(
    '2025-09-29',
    '2025-10-27',
    (wall) => Number(wall.slice(11, 13)) * 100 + Number(wall.slice(14, 16)),
  );
  const lookup = new OmiePriceLookup(files);

  it('applies an hourly price to the four quarter-hours of the hour before 2025-10-01', () => {
    // Lisbon 21:00 to 22:00 is Spanish 22:00 to 23:00: price 2200 for all four quarters.
    const start = lisbonToUtc('2025-09-30T21:00');
    for (let i = 0; i < 4; i++) {
      expect(lookup.priceAt(start + i * QUARTER_HOUR_MS)).toBe(2200);
    }
  });

  it('applies quarter-hourly prices from market day 2025-10-01', () => {
    const start = lisbonToUtc('2025-09-30T23:00');
    expect([0, 1, 2, 3].map((i) => lookup.priceAt(start + i * QUARTER_HOUR_MS))).toEqual([
      0, 15, 30, 45,
    ]);
  });

  it('prices both repeated hours of the autumn clock change separately', () => {
    expect(lookup.priceAt(lisbonToUtc('2025-10-26T01:15', 'first'))).toBe(215);
    expect(lookup.priceAt(lisbonToUtc('2025-10-26T01:15', 'second'))).toBe(215);
    expect(omieMarketPeriod(lisbonToUtc('2025-10-26T01:15', 'second'), 15).period).toBe(14);
  });

  it('returns undefined, never a filled value, for a missing day, a wrong period count or a bad value', () => {
    const day = (p: number[], res: 15 | 60 = 60) => ({ res, p });
    const broken: OmieYearFile = {
      schema: 1,
      source: 'synthetic',
      unit: 'EUR/MWh',
      zone: 'PT',
      days: {
        '2024-02-01': day(new Array(23).fill(50)),
        '2024-02-02': day([Number.NaN, ...new Array(23).fill(50)]),
        '2024-02-03': day(new Array(24).fill(50)),
      },
    };
    const partial = new OmiePriceLookup([broken]);
    expect(partial.priceAt(lisbonToUtc('2024-02-01T10:00'))).toBeUndefined();
    expect(partial.priceAt(lisbonToUtc('2024-02-01T23:00'))).toBeUndefined();
    expect(partial.priceAt(lisbonToUtc('2024-02-01T23:15'))).toBeUndefined();
    expect(partial.priceAt(lisbonToUtc('2024-02-02T00:00'))).toBe(50);
    expect(partial.priceAt(lisbonToUtc('2024-02-04T10:00'))).toBeUndefined();
  });

  it('reads the committed OMIE data in Spanish time', () => {
    const year = JSON.parse(
      readFileSync(resolve(process.cwd(), 'public/data/omie/2025.json'), 'utf8'),
    ) as OmieYearFile;
    const real = new OmiePriceLookup([year]);
    const first = year.days['2025-01-01'].p;
    // Lisbon 2025-01-01 00:00 is the second hour of market day 2025-01-01.
    expect(real.priceAt(lisbonToUtc('2025-01-01T00:00'))).toBe(first[1]);
    // Lisbon 2024-12-31 23:00 is the first hour of market day 2025-01-01.
    expect(real.priceAt(lisbonToUtc('2024-12-31T23:00'))).toBe(first[0]);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildOmieFiles } from '../../testing/engine-fixtures';
import { FIXTURE_FILES } from '../../testing/synthetic-fixtures';
import type { Catalogue } from './catalogue-model';
import { CostAnalysis, CostSettings, calculateCosts } from './cost-engine';
import { ParsedConsumption, parseEredesConsumption } from './eredes-parser';
import { OmiePriceLookup, OmieYearFile } from './omie-time';

/**
 * The synthetic 2025 year file through parser and engine, against the calculator values in
 * docs/HAND-CHECK.md. Keep the constants below in sync with that document.
 */
const HAND = {
  totalKwh: 3949.3875,
  dailyEmptyKwh: 1131.23725,
  totals: {
    'edp-eletricidade-simple': 1044.22,
    'ezu-premium-bi-hourly': 1026.52,
    'coopernico-unico-simple': 1002.29,
  },
} as const;

/** Synthetic OMIE fixture from docs/HAND-CHECK.md: 50 EUR/MWh from Spanish 23:00 to 09:00, 110 otherwise. */
function handCheckOmie(): OmieYearFile[] {
  return buildOmieFiles('2025-01-01', '2026-01-01', (wall) => {
    const hour = Number(wall.slice(11, 13));
    return hour >= 23 || hour < 9 ? 50 : 110;
  });
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as T;
}

const SETTINGS: CostSettings = {
  contractedKva: 6.9,
  largeFamily: false,
  current: {
    kind: 'manual',
    tariff: { tariffType: 'simple', energyEurKwh: { simple: 0.16 }, powerEurDay: 0.4 },
  },
};

describe('hand-checked synthetic year 2025', () => {
  let consumption: ParsedConsumption;
  let catalogue: Catalogue;

  beforeAll(() => {
    consumption = parseEredesConsumption(
      new Uint8Array(
        readFileSync(resolve(process.cwd(), '../fixtures/synthetic', FIXTURE_FILES.year)),
      ),
    );
    catalogue = readJson<Catalogue>('public/data/catalogue.json');
  });

  it('starts from the aggregates used in the hand check', () => {
    expect(consumption.metadata.totalKwh).toBeCloseTo(HAND.totalKwh, 6);
    expect(consumption.metadata.missingIntervals).toBe(0);
    const dailyEmpty = consumption.intervals
      .filter((interval) => interval.localMinute < 8 * 60 || interval.localMinute >= 22 * 60)
      .reduce((sum, interval) => sum + interval.kwh, 0);
    expect(dailyEmpty).toBeCloseTo(HAND.dailyEmptyKwh, 6);
  });

  it('matches each hand-computed total within 1 %', () => {
    const result = calculateCosts(
      consumption,
      { catalogue, omie: new OmiePriceLookup(handCheckOmie()) },
      SETTINGS,
    );
    expect(result.period.days).toBe(365);
    expect(result.period.annualised).toBe(false);
    for (const [id, hand] of Object.entries(HAND.totals)) {
      const total = result.ranking.find((entry) => entry.id === id)?.total ?? Number.NaN;
      expect(Math.abs(total - hand) / hand, `${id}: engine ${total}, hand ${hand}`).toBeLessThan(
        0.01,
      );
    }
    const coopernico = result.ranking.find((entry) => entry.id === 'coopernico-unico-simple');
    expect(coopernico?.unpricedQuarterHours).toBe(0);
  });

  it('computes the full year for 11 tariffs in under 3 s with the committed OMIE data', () => {
    const omie = new OmiePriceLookup([
      readJson<OmieYearFile>('public/data/omie/2025.json'),
      readJson<OmieYearFile>('public/data/omie/2026.json'),
    ]);
    const started = performance.now();
    const result: CostAnalysis = calculateCosts(consumption, { catalogue, omie }, SETTINGS);
    const elapsed = performance.now() - started;
    expect(result.ranking).toHaveLength(11);
    expect(result.omieQuarterHoursWithoutPrice).toBe(0);
    expect(elapsed).toBeLessThan(3000);
    for (const entry of result.ranking) {
      const monthSum = entry.months.reduce((sum, month) => sum + month.total, 0);
      expect(Math.abs(monthSum - entry.total)).toBeLessThan(0.01);
      expect(entry.months).toHaveLength(12);
    }
  });
});

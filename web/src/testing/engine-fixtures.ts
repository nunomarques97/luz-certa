import type { Catalogue, Offer } from '../app/engine/catalogue-model';
import type { ConsumptionInterval, ParsedConsumption } from '../app/engine/eredes-parser';
import { QUARTER_HOUR_MS, toLisbonLocal } from '../app/engine/lisbon-time';
import type { OmieYearFile } from '../app/engine/omie-time';
import { seededRandom } from './synthetic-fixtures';

/**
 * Test data for the cost engine: a small catalogue with round numbers, consumption built from
 * quarter-hour values, and OMIE files built with the host time zone database (Intl,
 * Europe/Madrid), independent of the engine's own Spanish-time mapping.
 */

const SOURCE = 'https://example.org/source';

/** Lisbon wall-clock date-time ("2024-01-06T09:15") to UTC milliseconds, via Intl. */
export function lisbonToUtc(wall: string, occurrence: 'first' | 'second' = 'first'): number {
  const asUtc = Date.parse(`${wall}:00Z`);
  const matches = [asUtc - 3_600_000, asUtc].filter((utc) => lisbonWallIntl(utc) === wall);
  if (matches.length === 0) {
    throw new Error(`No Lisbon instant for ${wall}`);
  }
  return occurrence === 'second' ? matches[matches.length - 1] : matches[0];
}

const lisbonFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Lisbon',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const madridFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function wallOf(format: Intl.DateTimeFormat, utcMs: number): string {
  const parts = Object.fromEntries(
    format.formatToParts(new Date(utcMs)).map((part) => [part.type, part.value]),
  );
  return `${parts['year']}-${parts['month']}-${parts['day']}T${parts['hour']}:${parts['minute']}`;
}

export function lisbonWallIntl(utcMs: number): string {
  return wallOf(lisbonFormat, utcMs);
}

/** Spanish peninsular wall clock ("YYYY-MM-DDTHH:MM") of a UTC instant, from the time zone database. */
export function madridWallIntl(utcMs: number): string {
  return wallOf(madridFormat, utcMs);
}

/**
 * OMIE year files for every market day whose Spanish date is in [fromDay, toDay]. Prices come from
 * `priceFor(spanishWallStart)`, called with the Spanish wall-clock start of each market period.
 * Days before `quarterHourFrom` are hourly, later days quarter-hourly, like the published data.
 */
export function buildOmieFiles(
  fromDay: string,
  toDay: string,
  priceFor: (spanishWallStart: string) => number,
  quarterHourFrom = '2025-10-01',
): OmieYearFile[] {
  const quartersByDay = new Map<string, string[]>();
  // Spanish midnight is at 22:00 or 23:00 UTC of the previous day; start early and filter by date.
  const first = Date.parse(`${fromDay}T00:00:00Z`) - 3 * 3_600_000;
  const last = Date.parse(`${toDay}T00:00:00Z`) + 27 * 3_600_000;
  for (let utc = first; utc < last; utc += QUARTER_HOUR_MS) {
    const wall = madridWallIntl(utc);
    const day = wall.slice(0, 10);
    if (day < fromDay || day > toDay) {
      continue;
    }
    const list = quartersByDay.get(day) ?? [];
    list.push(wall);
    quartersByDay.set(day, list);
  }
  const files = new Map<number, OmieYearFile>();
  for (const [day, quarters] of quartersByDay) {
    const res = day < quarterHourFrom ? 60 : 15;
    const starts = res === 60 ? quarters.filter((_, index) => index % 4 === 0) : quarters;
    const year = Number(day.slice(0, 4));
    const file = files.get(year) ?? {
      schema: 1,
      source: 'synthetic',
      unit: 'EUR/MWh',
      zone: 'PT',
      days: {},
    };
    file.days[day] = { res, p: starts.map(priceFor) };
    files.set(year, file);
  }
  return [...files.values()];
}

/**
 * Consumption with one value per quarter-hour from `startUtc`; null leaves a gap (missing reading).
 * Metadata is computed the way the parser does.
 */
export function buildConsumption(
  startUtc: number,
  kwhPerQuarter: readonly (number | null)[],
): ParsedConsumption {
  const intervals: ConsumptionInterval[] = [];
  kwhPerQuarter.forEach((kwh, index) => {
    if (kwh === null) {
      return;
    }
    const utc = startUtc + index * QUARTER_HOUR_MS;
    const local = toLisbonLocal(utc);
    intervals.push({
      startUtc: utc,
      localDate: local.date,
      localMinute: local.minuteOfDay,
      utcOffsetMinutes: local.offsetMinutes,
      kw: kwh * 4,
      kwh,
      estimated: false,
    });
  });
  const periodStartUtc = intervals[0].startUtc;
  const periodEndUtc = intervals[intervals.length - 1].startUtc + QUARTER_HOUR_MS;
  const expected = (periodEndUtc - periodStartUtc) / QUARTER_HOUR_MS;
  return {
    intervals,
    metadata: {
      periodStart: toLisbonLocal(periodStartUtc).iso,
      periodEnd: toLisbonLocal(periodEndUtc).iso,
      periodStartUtc,
      periodEndUtc,
      intervalCount: intervals.length,
      expectedIntervalCount: expected,
      missingIntervals: expected - intervals.length,
      missingRanges: [],
      duplicates: 0,
      estimatedIntervals: 0,
      totalKwh: intervals.reduce((sum, interval) => sum + interval.kwh, 0),
      consumptionColumn: 'Consumo registado (kW)',
    },
  };
}

/** Same kWh in every quarter-hour of `days` whole Lisbon days from `fromDate`. */
export function flatConsumption(
  fromDate: string,
  toDateExclusive: string,
  kwh: number,
): ParsedConsumption {
  const start = lisbonToUtc(`${fromDate}T00:00`);
  const end = lisbonToUtc(`${toDateExclusive}T00:00`);
  return buildConsumption(start, new Array<number>((end - start) / QUARTER_HOUR_MS).fill(kwh));
}

/** Deterministic kWh values between 0 and 0.5 (three decimals). */
export function seededValues(count: number, seed: number): number[] {
  const random = seededRandom(seed);
  return Array.from({ length: count }, () => Math.round(random() * 500) / 1000);
}

const POWER_LEVELS = [1.15, 2.3, 3.45, 4.6, 5.75, 6.9, 10.35, 13.8, 17.25, 20.7];

function sourced(): {
  source_url: string;
  verified_on: string;
  unverified: string[];
  notes: string[];
} {
  return { source_url: SOURCE, verified_on: '2026-10-02', unverified: [], notes: [] };
}

export function fixedOffer(
  id: string,
  overrides: Partial<Offer> = {},
  power = 0.5,
  energy = 0.2,
): Offer {
  return {
    ...sourced(),
    id,
    supplier: `Supplier ${id}`,
    name: `Offer ${id}`,
    pricing: 'fixed',
    tariff_type: 'simple',
    cycle: null,
    erse_offer_code: null,
    offer_url: null,
    additional_sources: [],
    conditions: [],
    prices: POWER_LEVELS.map((kva) => ({
      kva,
      power_eur_day: power,
      energy_eur_kwh: { simple: energy },
    })),
    power_formula: null,
    formula: null,
    ...overrides,
  };
}

export function biHourlyOffer(
  id: string,
  cycle: 'daily' | 'weekly',
  empty: number,
  outOfEmpty: number,
): Offer {
  return fixedOffer(id, {
    tariff_type: 'bi_hourly',
    cycle,
    prices: POWER_LEVELS.map((kva) => ({
      kva,
      power_eur_day: 0.5,
      energy_eur_kwh: { out_of_empty: outOfEmpty, empty },
    })),
  });
}

export function indexedOffer(
  id: string,
  overrides: Partial<NonNullable<Offer['formula']>> = {},
): Offer {
  return fixedOffer(id, {
    pricing: 'omie_indexed',
    prices: POWER_LEVELS.map((kva) => ({ kva, power_eur_day: 0.5, energy_eur_kwh: null })),
    formula: {
      type: 'omie_indexed',
      omie_averaging: 'market_period',
      k_eur_mwh: 10,
      loss_factor: { basis: 'fixed', value: 0.1, value_kind: 'published', source_url: SOURCE },
      multiplier: 2,
      adder_eur_mwh: 5,
      adder_components: [{ id: 'k2', eur_mwh: 5 }],
      includes_tar: true,
      extra_fees: [{ id: 'fee', label: 'Fee', eur_kwh: 0.001, source_url: SOURCE }],
      unpriced_components: [],
      ...overrides,
    },
  });
}

/**
 * Catalogue with round numbers: VAT 20 %, no reduced rates and no fees unless a test adds them.
 * TAR periods cover 2024-01-01 to 2026-12-31 with a change on 2024-06-01.
 */
export function testCatalogue(offers: Offer[]): Catalogue {
  const empty = (ranges: [string, string][]) => ({ empty: ranges });
  const daily = empty([
    ['00:00', '08:00'],
    ['22:00', '24:00'],
  ]);
  const tar = (id: string, from: string, to: string, simple: number, power: number) => ({
    ...sourced(),
    id,
    valid_from: from,
    valid_to: to,
    page_url: null,
    energy_eur_kwh: { simple, bi_hourly: { out_of_empty: simple * 2, empty: simple / 2 } },
    power_eur_day: POWER_LEVELS.map((kva) => ({ kva, eur_day: power })),
  });
  return {
    schema_version: 1,
    catalogue_version: '2026.10.02',
    currency: 'EUR',
    prices_include_vat: false,
    scope: {
      market: 'test',
      voltage_level: 'BTN',
      catalogue_period: { from: '2024-01-01', to: '2026-12-31' },
    },
    cycles: {
      ...sourced(),
      page_url: null,
      cycles: {
        daily: {
          winter: { weekday: daily, saturday: daily, sunday: daily },
          summer: { weekday: daily, saturday: daily, sunday: daily },
        },
        weekly: {
          winter: {
            weekday: empty([['00:00', '07:00']]),
            saturday: empty([
              ['00:00', '09:30'],
              ['13:00', '18:30'],
              ['22:00', '24:00'],
            ]),
            sunday: empty([['00:00', '24:00']]),
          },
          summer: {
            weekday: empty([['00:00', '07:00']]),
            saturday: empty([
              ['00:00', '09:00'],
              ['14:00', '20:00'],
              ['22:00', '24:00'],
            ]),
            sunday: empty([['00:00', '24:00']]),
          },
        },
      },
    },
    access_tariffs: [
      tar('tar-a', '2024-01-01', '2024-05-31', 0.05, 0.1),
      tar('tar-b', '2024-06-01', '2026-12-31', 0.06, 0.2),
    ],
    taxes: {
      vat: { ...sourced(), standard_rate: 0.2, legal_reference: 'test', rules: [] },
      fees: [],
    },
    offers,
    unverified: [],
  };
}

import { DAY_MS, formatWallDate, lisbonOffsetMinutes } from './lisbon-time';

/**
 * Mapping between Lisbon quarter-hours and OMIE market periods. This is the only place where
 * Spanish market time is derived.
 *
 * OMIE market days and periods follow Spanish peninsular time (CET/CEST). Spain and mainland
 * Portugal switch summer time at the same UTC instant, so Spanish time is always Lisbon time
 * plus one hour. A market day therefore starts at 23:00 Lisbon time on the previous Lisbon day,
 * and has 23 or 25 hours on the clock-change days.
 */

const HOUR_MS = 60 * 60 * 1000;
const dayStartCache = new Map<string, number>();

/** UTC offset of Spanish peninsular time at a UTC instant. */
export function spainOffsetMinutes(utcMs: number): 60 | 120 {
  return lisbonOffsetMinutes(utcMs) === 60 ? 120 : 60;
}

/** OMIE market day (Spanish calendar date, YYYY-MM-DD) containing the given UTC instant. */
export function marketDayOf(utcMs: number): string {
  return formatWallDate(utcMs + spainOffsetMinutes(utcMs) * 60_000);
}

/** UTC instant of Spanish midnight that starts the market day. Midnight is never inside a clock change. */
export function marketDayStartUtc(marketDay: string): number {
  const cached = dayStartCache.get(marketDay);
  if (cached !== undefined) {
    return cached;
  }
  const wallMidnight = Date.parse(`${marketDay}T00:00:00Z`);
  const winterCandidate = wallMidnight - HOUR_MS;
  const start =
    spainOffsetMinutes(winterCandidate) === 60 ? winterCandidate : wallMidnight - 2 * HOUR_MS;
  dayStartCache.set(marketDay, start);
  return start;
}

/** Length of the market day in minutes: 1380, 1440 or 1500. */
export function marketDayMinutes(marketDay: string): number {
  const start = marketDayStartUtc(marketDay);
  const next = formatWallDate(Date.parse(`${marketDay}T00:00:00Z`) + DAY_MS);
  return (marketDayStartUtc(next) - start) / 60_000;
}

export interface MarketPeriod {
  marketDay: string;
  /** 1-based OMIE period number within the market day. */
  period: number;
}

/**
 * OMIE market period that contains the quarter-hour starting at `startUtc`, for a market day
 * published with the given resolution (60 before 2025-10-01, 15 from then on). With hourly
 * resolution the four quarter-hours of an hour share one period.
 */
export function omieMarketPeriod(startUtc: number, resolutionMinutes: 15 | 60): MarketPeriod {
  const marketDay = marketDayOf(startUtc);
  const elapsed = startUtc - marketDayStartUtc(marketDay);
  return { marketDay, period: Math.floor(elapsed / (resolutionMinutes * 60_000)) + 1 };
}

/** One market day as stored in web/public/data/omie/<year>.json. */
export interface OmieDay {
  res: 15 | 60;
  /** EUR/MWh per market period, in published order. */
  p: number[];
}

export interface OmieYearFile {
  schema: 1;
  source: string;
  unit: 'EUR/MWh';
  zone: 'PT';
  days: Record<string, OmieDay>;
}

/**
 * Price lookup by Lisbon quarter-hour. A quarter-hour has no price when its market day is absent,
 * when the day has an unexpected number of periods, or when the value is not a finite number.
 * Missing prices are reported by callers; they are never filled in.
 */
export class OmiePriceLookup {
  private readonly days = new Map<string, OmieDay>();
  private readonly validDays = new Map<string, number | null>();

  constructor(files: readonly OmieYearFile[]) {
    for (const file of files) {
      for (const [day, entry] of Object.entries(file.days)) {
        this.days.set(day, entry);
      }
    }
  }

  /** EUR/MWh for the quarter-hour starting at `startUtc`, or undefined when not available. */
  priceAt(startUtc: number): number | undefined {
    const marketDay = marketDayOf(startUtc);
    const entry = this.days.get(marketDay);
    if (!entry || !this.isValidDay(marketDay, entry)) {
      return undefined;
    }
    const { period } = omieMarketPeriod(startUtc, entry.res);
    const price = entry.p[period - 1];
    return typeof price === 'number' && Number.isFinite(price) ? price : undefined;
  }

  private isValidDay(marketDay: string, entry: OmieDay): boolean {
    let checked = this.validDays.get(marketDay);
    if (checked === undefined) {
      const expected =
        entry.res === 15 || entry.res === 60 ? marketDayMinutes(marketDay) / entry.res : Number.NaN;
      checked = Array.isArray(entry.p) && entry.p.length === expected ? expected : null;
      this.validDays.set(marketDay, checked);
    }
    return checked !== null;
  }
}

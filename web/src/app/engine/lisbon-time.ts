/**
 * Europe/Lisbon (mainland Portugal) civil time without relying on the host time zone.
 *
 * Mainland Portugal uses WET (UTC+0) in winter and WEST (UTC+1) in summer. Since 1996 the
 * switch follows the EU rule: summer time starts on the last Sunday of March at 01:00 UTC
 * and ends on the last Sunday of October at 01:00 UTC.
 *
 * "Wall" milliseconds are local date-times encoded as if they were UTC (Date.UTC(y, m, d, h, mi)).
 */

export const QUARTER_HOUR_MS = 15 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Years for which the EU rule is applied. Outside this range input is rejected by callers. */
export const MIN_SUPPORTED_YEAR = 2000;
export const MAX_SUPPORTED_YEAR = 2100;

export type LisbonOffsetMinutes = 0 | 60;

export interface LisbonLocalTime {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** Minutes since local midnight on the wall clock (0..1439). */
  minuteOfDay: number;
  /** UTC offset in force at this instant. */
  offsetMinutes: LisbonOffsetMinutes;
  /** Local date-time with offset, e.g. 2025-03-30T02:15+01:00. */
  iso: string;
}

function lastSundayAt0100Utc(year: number, monthIndex: number): number {
  const lastDay = Date.UTC(year, monthIndex + 1, 0, 1);
  return lastDay - new Date(lastDay).getUTCDay() * DAY_MS;
}

const transitionCache = new Map<number, readonly [number, number]>();

/** UTC instants at which summer time starts and ends in the given year. */
export function summerTimeBounds(year: number): readonly [number, number] {
  let bounds = transitionCache.get(year);
  if (!bounds) {
    bounds = [lastSundayAt0100Utc(year, 2), lastSundayAt0100Utc(year, 9)];
    transitionCache.set(year, bounds);
  }
  return bounds;
}

export function lisbonOffsetMinutes(utcMs: number): LisbonOffsetMinutes {
  const [start, end] = summerTimeBounds(new Date(utcMs).getUTCFullYear());
  return utcMs >= start && utcMs < end ? 60 : 0;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function formatWallDate(wallMs: number): string {
  const d = new Date(wallMs);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function toLisbonLocal(utcMs: number): LisbonLocalTime {
  const offsetMinutes = lisbonOffsetMinutes(utcMs);
  const wallMs = utcMs + offsetMinutes * 60_000;
  const d = new Date(wallMs);
  const minuteOfDay = d.getUTCHours() * 60 + d.getUTCMinutes();
  const date = formatWallDate(wallMs);
  const iso = `${date}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}${offsetMinutes ? '+01:00' : '+00:00'}`;
  return { date, minuteOfDay, offsetMinutes, iso };
}

/**
 * Possible UTC instants for a wall-clock label that marks the END of a quarter-hour interval.
 *
 * The offset that applies is the one in force during the interval (just before the end instant).
 * Returns two instants inside the autumn repeated hour, one normally, and none for labels that
 * cannot exist. A label that equals the first wall time after the spring jump (02:00) is accepted
 * as the jump instant, because exporters may print the end instant in the new offset.
 */
export function utcCandidatesForIntervalEnd(wallEndMs: number): number[] {
  const candidates: number[] = [];
  for (const offset of [60, 0] as const) {
    const utc = wallEndMs - offset * 60_000;
    if (lisbonOffsetMinutes(utc - 1) === offset) {
      candidates.push(utc);
    }
  }
  if (candidates.length === 0) {
    for (const offset of [60, 0] as const) {
      const utc = wallEndMs - offset * 60_000;
      if (lisbonOffsetMinutes(utc) === offset) {
        candidates.push(utc);
      }
    }
  }
  return candidates.sort((a, b) => a - b);
}

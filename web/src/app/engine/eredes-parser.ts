import {
  LisbonOffsetMinutes,
  MAX_SUPPORTED_YEAR,
  MIN_SUPPORTED_YEAR,
  QUARTER_HOUR_MS,
  lisbonOffsetMinutes,
  toLisbonLocal,
  utcCandidatesForIntervalEnd,
} from './lisbon-time';
import { ConsumptionParseError } from './parse-errors';
import { CellValue, SheetRow, readFirstWorksheet } from './xlsx-sheet-reader';

/**
 * Parser for the E-Redes Balcão Digital 15-minute consumption export (.xlsx).
 * See docs/E-REDES-FORMAT.md for the layout and the sources it was built from.
 *
 * Pure TypeScript with no DOM access, so it runs inside a Web Worker.
 */

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_DECOMPRESSED_BYTES = 200 * 1024 * 1024;
/** About eleven years of quarter-hours plus header rows. */
export const MAX_SHEET_ROWS = 400_000;
/** Header row is searched within the first rows only. */
const HEADER_SEARCH_ROWS = 60;
const MAX_REPORTED_GAPS = 100;

export type ConsumptionColumn =
  | 'Consumo medido na IC, Ativa (kW)'
  | 'Consumo registado, Ativa (kW)'
  | 'Consumo registado (kW)';

/** Consumption columns in order of preference: energy drawn from the grid comes first. */
const CONSUMPTION_COLUMNS: readonly ConsumptionColumn[] = [
  'Consumo medido na IC, Ativa (kW)',
  'Consumo registado, Ativa (kW)',
  'Consumo registado (kW)',
];

/** Other known headers. They are recognised but not used. */
const IGNORED_COLUMNS: readonly string[] = [
  'Injeção na rede medida na IC, Ativa (kW)',
  'Injeção registada, Ativa (kW)',
  'Injeção registada (kW)',
];

export interface ConsumptionInterval {
  /** Interval start as a UTC epoch in milliseconds. */
  startUtc: number;
  /** Local (Europe/Lisbon) calendar date of the interval start, YYYY-MM-DD. */
  localDate: string;
  /** Local wall-clock minute of the interval start (0..1425, multiple of 15). */
  localMinute: number;
  /** UTC offset of Lisbon time during the interval. */
  utcOffsetMinutes: LisbonOffsetMinutes;
  /** Average power over the quarter-hour as exported, in kW. */
  kw: number;
  /** Energy in the quarter-hour: kW / 4. */
  kwh: number;
  /** True when E-Redes marks the reading as estimated. */
  estimated: boolean;
}

export interface MissingRange {
  /** First missing interval start (UTC ms). */
  startUtc: number;
  /** Number of consecutive missing quarter-hours. */
  count: number;
}

export interface ConsumptionMetadata {
  /** Start of the first interval, Lisbon local time with offset. */
  periodStart: string;
  /** End of the last interval, Lisbon local time with offset. */
  periodEnd: string;
  periodStartUtc: number;
  periodEndUtc: number;
  /** Intervals with a reading. */
  intervalCount: number;
  /** Quarter-hours between period start and end, DST days included (92 or 100 per day). */
  expectedIntervalCount: number;
  /** Quarter-hours inside the period without a reading. They are never filled in. */
  missingIntervals: number;
  /** Missing ranges in time order, capped at the first 100 ranges. */
  missingRanges: MissingRange[];
  /** Rows whose quarter-hour was already present. The first reading is kept. */
  duplicates: number;
  estimatedIntervals: number;
  totalKwh: number;
  consumptionColumn: ConsumptionColumn;
}

export interface ParsedConsumption {
  intervals: ConsumptionInterval[];
  metadata: ConsumptionMetadata;
}

export interface ParseOptions {
  maxFileBytes?: number;
  maxDecompressedBytes?: number;
  maxRows?: number;
}

/** Normalises header text for comparison: Unicode NFC, single spaces, lower case. */
function normalizeHeader(value: CellValue): string {
  if (value === null || typeof value === 'boolean') {
    return '';
  }
  return String(value).normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

interface ColumnLayout {
  date: number;
  time: number;
  consumption: number;
  consumptionName: ConsumptionColumn;
  /** Status column describing the consumption value, or -1. */
  status: number;
}

function findHeader(rows: SheetRow[]): { index: number; layout: ColumnLayout } {
  const headerIndex = rows
    .slice(0, HEADER_SEARCH_ROWS)
    .findIndex((row) => {
      const names = row.cells.map(normalizeHeader);
      return names.includes('data') && names.includes('hora');
    });
  if (headerIndex < 0) {
    throw new ConsumptionParseError('MISSING_COLUMNS');
  }

  const headerRow = rows[headerIndex];
  const consumptionNames = CONSUMPTION_COLUMNS.map((name) => normalizeHeader(name));
  const ignoredNames = IGNORED_COLUMNS.map((name) => normalizeHeader(name));
  let date = -1;
  let time = -1;
  const consumption = new Map<number, number>();
  const statusAfter = new Map<number, number>();
  let previousValueColumn = -1;

  headerRow.cells.forEach((cell, column) => {
    const name = normalizeHeader(cell);
    if (name === '') {
      return;
    }
    if (name === 'data' && date < 0) {
      date = column;
    } else if (name === 'hora' && time < 0) {
      time = column;
    } else if (name === 'estado') {
      if (previousValueColumn >= 0 && !statusAfter.has(previousValueColumn)) {
        statusAfter.set(previousValueColumn, column);
      }
    } else if (consumptionNames.includes(name) && !consumption.has(consumptionNames.indexOf(name))) {
      consumption.set(consumptionNames.indexOf(name), column);
      previousValueColumn = column;
    } else if (ignoredNames.includes(name)) {
      previousValueColumn = column;
    } else {
      throw new ConsumptionParseError('UNKNOWN_COLUMN', { row: headerRow.rowNumber, column: column + 1 });
    }
  });

  const preferred = [...consumption.keys()].sort((a, b) => a - b)[0];
  if (date < 0 || time < 0 || preferred === undefined) {
    throw new ConsumptionParseError('MISSING_COLUMNS', { row: headerRow.rowNumber });
  }
  const consumptionColumn = consumption.get(preferred) as number;
  return {
    index: headerIndex,
    layout: {
      date,
      time,
      consumption: consumptionColumn,
      consumptionName: CONSUMPTION_COLUMNS[preferred],
      status: statusAfter.get(consumptionColumn) ?? -1,
    },
  };
}

/** Rejects files whose own metadata declares an interval other than 15 minutes. */
function checkDeclaredInterval(rows: SheetRow[], headerIndex: number): void {
  for (const row of rows.slice(0, headerIndex)) {
    const label = normalizeHeader(row.cells[0] ?? null).replace(/:$/, '');
    if (label === 'intervalo') {
      const value = normalizeHeader(row.cells[1] ?? null).replace(/\s/g, '');
      if (value !== '' && value !== '15min' && value !== '15minutos') {
        throw new ConsumptionParseError('NOT_15_MINUTE', { row: row.rowNumber, column: 2 });
      }
    }
  }
}

const EXCEL_EPOCH_1900_MS = Date.UTC(1899, 11, 30);
const EXCEL_EPOCH_1904_MS = Date.UTC(1904, 0, 1);

function isEmpty(value: CellValue | undefined): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function validDate(year: number, month: number, day: number): number | null {
  if (year < MIN_SUPPORTED_YEAR || year > MAX_SUPPORTED_YEAR || month < 1 || month > 12 || day < 1) {
    return null;
  }
  const wall = Date.UTC(year, month - 1, day);
  return new Date(wall).getUTCDate() === day ? wall : null;
}

/** Local calendar date as wall milliseconds at midnight. */
function readDate(value: CellValue | undefined, date1904: boolean): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 1) {
      return null;
    }
    const wall = (date1904 ? EXCEL_EPOCH_1904_MS : EXCEL_EPOCH_1900_MS) + Math.floor(value + 1e-9) * 86_400_000;
    const d = new Date(wall);
    return validDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.trim().replace(/[ T]00:00(?::00)?$/, '');
  let match = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(text);
  if (match) {
    return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (match) {
    return validDate(Number(match[3]), Number(match[2]), Number(match[1]));
  }
  return null;
}

/** Wall-clock minutes since midnight (0..1440), or null. */
function readTime(value: CellValue | undefined): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      return null;
    }
    // A time cell is a fraction of a day (1 = 24:00); a date-time serial keeps only its fraction.
    const fraction = value <= 1 ? value : value - Math.floor(value);
    const minutes = Math.round(fraction * 1440);
    return Math.abs(fraction * 1440 - minutes) < 0.01 && minutes <= 1440 ? minutes : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] === undefined ? 0 : Number(match[3]);
  if (minutes > 59 || seconds !== 0 || hours > 24 || (hours === 24 && minutes !== 0)) {
    return null;
  }
  return hours * 60 + minutes;
}

/** Non-negative kW value; undefined for an empty cell (missing reading); null when unreadable. */
function readKw(value: CellValue | undefined): number | null | undefined {
  if (isEmpty(value)) {
    return undefined;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.trim();
  if (!/^\d{1,7}(?:[.,]\d{1,15})?$/.test(text)) {
    return null;
  }
  return Number(text.replace(',', '.'));
}

function isEstimated(value: CellValue | undefined): boolean {
  return typeof value === 'string' && value.trim().toLowerCase().startsWith('estim');
}

function chooseEnd(candidates: number[], previousEnd: number | null, seen: Set<number>): number | null {
  if (candidates.length === 1) {
    return candidates[0];
  }
  if (previousEnd !== null) {
    const contiguous = candidates.find((c) => c === previousEnd + QUARTER_HOUR_MS);
    if (contiguous !== undefined) {
      return contiguous;
    }
    const later = candidates.find((c) => c > previousEnd && !seen.has(c));
    if (later !== undefined) {
      return later;
    }
  }
  return candidates.find((c) => !seen.has(c)) ?? candidates[0];
}

/**
 * Parses an E-Redes 15-minute export. Throws ConsumptionParseError with a typed code on rejection.
 * Readings are converted to energy with kWh = kW / 4. Missing quarter-hours are counted, not filled.
 */
export function parseEredesConsumption(input: Uint8Array | ArrayBuffer, options: ParseOptions = {}): ParsedConsumption {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > (options.maxFileBytes ?? MAX_FILE_BYTES)) {
    throw new ConsumptionParseError('FILE_TOO_LARGE');
  }

  const sheet = readFirstWorksheet(bytes, {
    maxDecompressedBytes: options.maxDecompressedBytes ?? MAX_DECOMPRESSED_BYTES,
    maxRows: options.maxRows ?? MAX_SHEET_ROWS,
  });
  const { index: headerIndex, layout } = findHeader(sheet.rows);
  checkDeclaredInterval(sheet.rows, headerIndex);

  const byStart = new Map<number, ConsumptionInterval>();
  const seenEnds = new Set<number>();
  let previousEnd: number | null = null;
  let duplicates = 0;

  for (let i = headerIndex + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i];
    const dateCell = row.cells[layout.date];
    const timeCell = row.cells[layout.time];
    const kwCell = row.cells[layout.consumption];
    if (row.cells.every(isEmpty)) {
      continue;
    }

    const dateWall = readDate(dateCell, sheet.date1904);
    if (dateWall === null) {
      throw new ConsumptionParseError('INVALID_DATE', { row: row.rowNumber, column: layout.date + 1 });
    }
    const minutes = readTime(timeCell);
    if (minutes === null) {
      throw new ConsumptionParseError('INVALID_DATE', { row: row.rowNumber, column: layout.time + 1 });
    }
    if (minutes % 15 !== 0) {
      throw new ConsumptionParseError('NOT_15_MINUTE', { row: row.rowNumber, column: layout.time + 1 });
    }
    const kw = readKw(kwCell);
    if (kw === null) {
      throw new ConsumptionParseError('INVALID_VALUE', { row: row.rowNumber, column: layout.consumption + 1 });
    }

    const candidates = utcCandidatesForIntervalEnd(dateWall + minutes * 60_000);
    if (candidates.length === 0) {
      throw new ConsumptionParseError('INVALID_DATE', { row: row.rowNumber, column: layout.time + 1 });
    }
    const end = chooseEnd(candidates, previousEnd, seenEnds) as number;
    previousEnd = end;
    if (seenEnds.has(end)) {
      duplicates++;
      continue;
    }
    seenEnds.add(end);
    if (kw === undefined) {
      continue;
    }

    const startUtc = end - QUARTER_HOUR_MS;
    const local = toLisbonLocal(startUtc);
    byStart.set(startUtc, {
      startUtc,
      localDate: local.date,
      localMinute: local.minuteOfDay,
      utcOffsetMinutes: local.offsetMinutes,
      kw,
      kwh: kw / 4,
      estimated: layout.status >= 0 && isEstimated(row.cells[layout.status]),
    });
  }

  const intervals = [...byStart.values()].sort((a, b) => a.startUtc - b.startUtc);
  if (intervals.length === 0) {
    throw new ConsumptionParseError('NO_DATA');
  }

  let quarterSteps = 0;
  const missingRanges: MissingRange[] = [];
  let missingIntervals = 0;
  for (let i = 1; i < intervals.length; i++) {
    const step = intervals[i].startUtc - intervals[i - 1].startUtc;
    if (step === QUARTER_HOUR_MS) {
      quarterSteps++;
    } else {
      const count = step / QUARTER_HOUR_MS - 1;
      missingIntervals += count;
      if (missingRanges.length < MAX_REPORTED_GAPS) {
        missingRanges.push({ startUtc: intervals[i - 1].startUtc + QUARTER_HOUR_MS, count });
      }
    }
  }
  // A 15-minute file has gaps as exceptions. When most consecutive readings are further apart
  // (for example an hourly file with one stray quarter-hour pair), the file is rejected.
  const steps = intervals.length - 1;
  if (steps > 0 && quarterSteps * 2 <= steps) {
    throw new ConsumptionParseError('NOT_15_MINUTE');
  }

  const periodStartUtc = intervals[0].startUtc;
  const periodEndUtc = intervals[intervals.length - 1].startUtc + QUARTER_HOUR_MS;
  let totalKwh = 0;
  let estimatedIntervals = 0;
  for (const interval of intervals) {
    totalKwh += interval.kwh;
    if (interval.estimated) {
      estimatedIntervals++;
    }
  }

  return {
    intervals,
    metadata: {
      periodStart: toLisbonLocal(periodStartUtc).iso,
      periodEnd: formatPeriodEnd(periodEndUtc),
      periodStartUtc,
      periodEndUtc,
      intervalCount: intervals.length,
      expectedIntervalCount: (periodEndUtc - periodStartUtc) / QUARTER_HOUR_MS,
      missingIntervals,
      missingRanges,
      duplicates,
      estimatedIntervals,
      totalKwh,
      consumptionColumn: layout.consumptionName,
    },
  };
}

/** End instants are shown with the offset that applied during the last interval. */
function formatPeriodEnd(endUtc: number): string {
  const offset = lisbonOffsetMinutes(endUtc - 1);
  const wall = new Date(endUtc + offset * 60_000).toISOString().slice(0, 16);
  return `${wall}${offset ? '+01:00' : '+00:00'}`;
}

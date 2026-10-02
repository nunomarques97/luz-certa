import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { zipSync } from 'fflate';

import {
  DETAILED_HEADER,
  DUPLICATE_FIXTURE,
  EredesWorkbookOptions,
  FIXTURE_FILES,
  GAP_FIXTURE,
  Reading,
  YEAR_MARKERS,
  buildEredesWorkbook,
  buildXlsx,
  lisbonQuarterLabels,
  syntheticReadings,
} from '../../testing/synthetic-fixtures';
import { MAX_DECOMPRESSED_BYTES, MAX_FILE_BYTES, ParsedConsumption, parseEredesConsumption } from './eredes-parser';
import { ConsumptionParseError, PARSE_ERROR_CODES, ParseErrorCode } from './parse-errors';

const FIXTURE_DIR = resolve(process.cwd(), '../fixtures/synthetic');

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURE_DIR, name)));
}

const DETAILED: EredesWorkbookOptions = {
  layout: 'detailed',
  headerRow: 15,
  values: 'comma-text',
  dates: 'text',
  strings: 'inline',
  sheetName: 'Leituras',
};

function workbook(readings: Reading[], options: Partial<EredesWorkbookOptions> = {}): Uint8Array {
  return buildEredesWorkbook(readings, { ...DETAILED, ...options });
}

function rejection(run: () => unknown): ConsumptionParseError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ConsumptionParseError);
    return error as ConsumptionParseError;
  }
  throw new Error('expected a rejection');
}

function expectCode(input: Uint8Array, code: ParseErrorCode, options = {}): ConsumptionParseError {
  const error = rejection(() => parseEredesConsumption(input, options));
  expect(error.code).toBe(code);
  expect(PARSE_ERROR_CODES).toContain(error.code);
  return error;
}

function intervalsOn(result: ParsedConsumption, localDate: string) {
  return result.intervals.filter((i) => i.localDate === localDate);
}

/** Two days in January, 192 quarter-hours. */
const TWO_DAYS = syntheticReadings('2025-01-15', '2025-01-17', 7);

describe('parseEredesConsumption: synthetic year 2025', () => {
  let result: ParsedConsumption;
  let elapsedMs: number;

  beforeAll(() => {
    const bytes = fixture(FIXTURE_FILES.year);
    const started = performance.now();
    result = parseEredesConsumption(bytes);
    elapsedMs = performance.now() - started;
  });

  it('parses the full year in under 3 s', () => {
    expect(elapsedMs).toBeLessThan(3000);
  });

  it('returns every quarter-hour of the year in Lisbon time with no gaps or duplicates', () => {
    const m = result.metadata;
    expect(m.intervalCount).toBe(35_040);
    expect(m.expectedIntervalCount).toBe(35_040);
    expect(m.missingIntervals).toBe(0);
    expect(m.missingRanges).toEqual([]);
    expect(m.duplicates).toBe(0);
    expect(m.periodStart).toBe('2025-01-01T00:00+00:00');
    expect(m.periodEnd).toBe('2026-01-01T00:00+00:00');
    expect(m.periodStartUtc).toBe(Date.UTC(2025, 0, 1));
    expect(m.periodEndUtc).toBe(Date.UTC(2026, 0, 1));
    expect(m.consumptionColumn).toBe('Consumo medido na IC, Ativa (kW)');
  });

  it('places every interval at the instant given by an independent Intl-based oracle', () => {
    const labels = lisbonQuarterLabels('2025-01-01', '2026-01-01');
    expect(result.intervals.map((i) => i.startUtc)).toEqual(labels.map((l) => l.startUtc));
    expect(result.intervals.map((i) => i.localDate)).toEqual(labels.map((l) => l.localDate));
  });

  it('converts kW to kWh by dividing by 4, matching the generated readings', () => {
    const readings = syntheticReadings('2025-01-01', '2026-01-01', 2025);
    let expectedTotal = 0;
    result.intervals.forEach((interval, index) => {
      expect(interval.kwh).toBe(interval.kw / 4);
      const markerIndex = (YEAR_MARKERS.times as readonly string[]).indexOf(readings[index].time);
      const kw = readings[index].date === YEAR_MARKERS.date && markerIndex >= 0 ? YEAR_MARKERS.kw[markerIndex] : readings[index].kw!;
      expect(interval.kw).toBe(kw);
      expectedTotal += kw / 4;
    });
    expect(result.metadata.totalKwh).toBeCloseTo(expectedTotal, 6);
  });

  it('has 92 quarter-hours on the spring-forward day and skips 01:00 to 02:00 local', () => {
    const day = intervalsOn(result, '2025-03-30');
    expect(day).toHaveLength(92);
    const minutes = day.map((i) => i.localMinute);
    expect(minutes.slice(0, 6)).toEqual([0, 15, 30, 45, 120, 135]);
    expect(minutes.some((m) => m >= 60 && m < 120)).toBe(false);
    expect(day[3].utcOffsetMinutes).toBe(0);
    expect(day[4].utcOffsetMinutes).toBe(60);
  });

  it('has 100 quarter-hours on the fall-back day with the repeated hour in time order', () => {
    const day = intervalsOn(result, '2025-10-26');
    expect(day).toHaveLength(100);
    const repeated = day.slice(4, 12).map((i) => [i.localMinute, i.utcOffsetMinutes]);
    expect(repeated).toEqual([
      [60, 60],
      [75, 60],
      [90, 60],
      [105, 60],
      [60, 0],
      [75, 0],
      [90, 0],
      [105, 0],
    ]);
    for (let i = 1; i < day.length; i++) {
      expect(day[i].startUtc - day[i - 1].startUtc).toBe(15 * 60_000);
    }
  });

  it('keeps the privacy marker run at 12:00 to 13:00 on 15 June', () => {
    const day = intervalsOn(result, '2025-06-15').filter((i) => i.localMinute >= 720 && i.localMinute < 780);
    expect(day.map((i) => i.kw)).toEqual([...YEAR_MARKERS.kw]);
    expect(day.map((i) => i.kwh)).toEqual(YEAR_MARKERS.kw.map((kw) => kw / 4));
    const others = result.intervals.filter((i) => !day.includes(i));
    expect(others.every((i) => i.kw <= 5.5)).toBe(true);
  });
});

describe('parseEredesConsumption: layouts and values', () => {
  it('converts kW to kWh as kW / 4', () => {
    const readings: Reading[] = [
      { date: '2025/01/15', time: '00:15', kw: 1.2 },
      { date: '2025/01/15', time: '00:30', kw: 4 },
      { date: '2025/01/15', time: '00:45', kw: 0 },
    ];
    const result = parseEredesConsumption(workbook(readings));
    expect(result.intervals.map((i) => i.kwh)).toEqual([0.3, 1, 0]);
    expect(result.metadata.totalKwh).toBeCloseTo(1.3, 12);
  });

  it('reads decimal comma text, decimal point text and numeric cells identically', () => {
    const comma = parseEredesConsumption(workbook(TWO_DAYS, { values: 'comma-text' }));
    const dot = parseEredesConsumption(workbook(TWO_DAYS, { values: 'dot-text' }));
    const numeric = parseEredesConsumption(workbook(TWO_DAYS, { values: 'number', strings: 'shared' }));
    expect(comma.intervals).toHaveLength(192);
    expect(dot.intervals).toEqual(comma.intervals);
    expect(numeric.intervals).toEqual(comma.intervals);
    expect(comma.intervals.map((i) => i.kw)).toEqual(TWO_DAYS.map((r) => r.kw));
  });

  it('reads Excel serial dates and day-fraction times', () => {
    const text = parseEredesConsumption(workbook(TWO_DAYS));
    const serial = parseEredesConsumption(workbook(TWO_DAYS, { dates: 'excel-serial', strings: 'shared' }));
    expect(serial.intervals).toEqual(text.intervals);
  });

  it('finds the header at any offset within the first rows', () => {
    const reference = parseEredesConsumption(workbook(TWO_DAYS));
    for (const headerRow of [1, 3, 15, 40]) {
      const result = parseEredesConsumption(workbook(TWO_DAYS, { headerRow }));
      expect(result.intervals).toEqual(reference.intervals);
    }
  });

  it('rejects a header placed beyond the searched rows', () => {
    expectCode(workbook(TWO_DAYS, { headerRow: 80 }), 'MISSING_COLUMNS');
  });

  it('accepts the 4-column layout and prefers the grid consumption column in the 10-column layout', () => {
    const simple = parseEredesConsumption(workbook(TWO_DAYS, { layout: 'simple' }));
    expect(simple.metadata.consumptionColumn).toBe('Consumo registado (kW)');

    const rows: (string | number | null)[][] = [
      [...DETAILED_HEADER],
      ['2025/01/15', '00:15', '0,5', 'Real', '0', 'Real', '0,9', 'Estimado', '0', 'Real'],
      ['2025/01/15', '00:30', '0,25', 'Estimado', '0', 'Real', '0,4', 'Real', '0', 'Real'],
    ];
    const result = parseEredesConsumption(buildXlsx({ sheetName: 'Leituras', rows, strings: 'inline' }));
    expect(result.metadata.consumptionColumn).toBe('Consumo medido na IC, Ativa (kW)');
    expect(result.intervals.map((i) => [i.kw, i.estimated])).toEqual([
      [0.5, false],
      [0.25, true],
    ]);
    expect(result.metadata.estimatedIntervals).toBe(1);
  });

  it('parses the partial 3-month fixture (4 columns, header on row 9, numeric cells)', () => {
    const result = parseEredesConsumption(fixture(FIXTURE_FILES.partial));
    expect(result.metadata.intervalCount).toBe(90 * 96 - 4);
    expect(result.metadata.missingIntervals).toBe(0);
    expect(result.metadata.periodStart).toBe('2025-01-01T00:00+00:00');
    expect(result.metadata.periodEnd).toBe('2025-04-01T00:00+01:00');
    expect(intervalsOn(result, '2025-03-30')).toHaveLength(92);
  });

  it('accepts 24:00 as the end of the day', () => {
    const readings: Reading[] = [
      { date: '2025/01/15', time: '23:45', kw: 1 },
      { date: '2025/01/15', time: '24:00', kw: 2 },
    ];
    const result = parseEredesConsumption(workbook(readings));
    expect(result.intervals.map((i) => [i.localDate, i.localMinute])).toEqual([
      ['2025-01-15', 1410],
      ['2025-01-15', 1425],
    ]);
  });

  it('accepts a spring-forward day that labels the jump as 02:00 instead of 01:00', () => {
    const day = syntheticReadings('2025-03-30', '2025-03-31', 330);
    expect(day).toHaveLength(92);
    const relabelled = day.map((r) => (r.time === '01:00' ? { ...r, time: '02:00' } : r));
    const result = parseEredesConsumption(workbook(relabelled));
    expect(result.metadata.intervalCount).toBe(92);
    expect(result.metadata.missingIntervals).toBe(0);

    const both = [...day.slice(0, 4), { ...day[3], time: '02:00' }, ...day.slice(4)];
    expect(parseEredesConsumption(workbook(both)).metadata.duplicates).toBe(1);
  });

  it('rejects a local time that does not exist on the spring-forward day', () => {
    const day = syntheticReadings('2025-03-30', '2025-03-31', 330);
    const bad = [...day.slice(0, 4), { date: '2025/03/30', time: '01:30', kw: 1 }, ...day.slice(4)];
    const error = expectCode(workbook(bad), 'INVALID_DATE');
    expect(error.details).toEqual({ row: 20, column: 2 });
  });
});

describe('parseEredesConsumption: gaps and duplicates', () => {
  it('counts missing quarter-hours without filling them', () => {
    const result = parseEredesConsumption(fixture(FIXTURE_FILES.gaps));
    const m = result.metadata;
    expect(m.missingIntervals).toBe(GAP_FIXTURE.expectedMissing);
    expect(m.expectedIntervalCount).toBe(28 * 96);
    expect(m.intervalCount).toBe(28 * 96 - GAP_FIXTURE.expectedMissing);
    expect(m.missingRanges.map((r) => r.count).sort((a, b) => b - a).slice(0, 2)).toEqual([96, 12]);
    expect(m.missingRanges.find((r) => r.count === 96)?.startUtc).toBe(Date.UTC(2025, 1, 10));
    expect(m.missingRanges.find((r) => r.count === 12)?.startUtc).toBe(Date.UTC(2025, 1, 20, 18, 0));
    expect(intervalsOn(result, GAP_FIXTURE.removedDay)).toHaveLength(0);
  });

  it('keeps the first reading of a repeated quarter-hour and counts duplicates', () => {
    const result = parseEredesConsumption(fixture(FIXTURE_FILES.duplicates));
    expect(result.metadata.duplicates).toBe(DUPLICATE_FIXTURE.repeated.length);
    expect(result.metadata.intervalCount).toBe(7 * 96);
    expect(result.metadata.missingIntervals).toBe(0);
    const original = syntheticReadings('2025-05-01', '2025-05-08', 202505);
    expect(result.intervals.map((i) => i.kw)).toEqual(original.map((r) => r.kw));
  });

  it('counts a duplicate that appears later in the file', () => {
    const late = [...TWO_DAYS, { ...TWO_DAYS[10], kw: 3 }];
    const result = parseEredesConsumption(workbook(late));
    expect(result.metadata.duplicates).toBe(1);
    expect(result.intervals[10].kw).toBe(TWO_DAYS[10].kw);
  });

  it('skips blank rows', () => {
    const rows: (string | null)[][] = [
      ['Data', 'Hora', 'Consumo registado (kW)', 'Estado'],
      ['2025/01/15', '00:15', '0,5', 'Real'],
      [null, null, null, null],
      ['2025/01/15', '00:30', '0,5', 'Real'],
    ];
    const result = parseEredesConsumption(buildXlsx({ sheetName: 'S', rows, strings: 'inline' }));
    expect(result.metadata.intervalCount).toBe(2);
  });
});

describe('parseEredesConsumption: rejections', () => {
  it('rejects input that is not an .xlsx file', () => {
    expectCode(fixture(FIXTURE_FILES.notXlsx), 'NOT_XLSX');
    expectCode(fixture(FIXTURE_FILES.noWorkbook), 'NOT_XLSX');
    expectCode(new Uint8Array(0), 'NOT_XLSX');
    expectCode(new TextEncoder().encode('%PDF-1.7\n'), 'NOT_XLSX');
    // Legacy .xls (OLE compound document signature).
    expectCode(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 'NOT_XLSX');
  });

  it('rejects files over 25 MB before reading them', () => {
    expect(MAX_FILE_BYTES).toBe(25 * 1024 * 1024);
    expectCode(new Uint8Array(MAX_FILE_BYTES + 1), 'FILE_TOO_LARGE');
    // At the limit the size check passes and the content check runs.
    expectCode(new Uint8Array(MAX_FILE_BYTES), 'NOT_XLSX');
  });

  it('rejects archives that declare more than 200 MB of decompressed content without inflating them', () => {
    expect(MAX_DECOMPRESSED_BYTES).toBe(200 * 1024 * 1024);
    const bytes = workbook(TWO_DAYS);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const directory = view.getUint32(bytes.length - 22 + 16, true);
    view.setUint32(directory + 24, MAX_DECOMPRESSED_BYTES + 1, true);
    const started = performance.now();
    expectCode(bytes, 'DECOMPRESSED_TOO_LARGE');
    expect(performance.now() - started).toBeLessThan(100);
  });

  it('stops inflating a zip bomb that under-declares its size', () => {
    // 64 MB of zeros compress to about 64 kB; the directory claims 1 kB.
    const bomb = zipSync({ 'xl/workbook.xml': new Uint8Array(64 * 1024 * 1024) }, { level: 9 });
    const view = new DataView(bomb.buffer, bomb.byteOffset, bomb.byteLength);
    const directory = view.getUint32(bomb.length - 22 + 16, true);
    view.setUint32(directory + 24, 1024, true);
    const started = performance.now();
    expectCode(bomb, 'MALFORMED_XLSX');
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('enforces the decompression budget across all entries read', () => {
    const bytes = fixture(FIXTURE_FILES.year);
    expectCode(bytes, 'DECOMPRESSED_TOO_LARGE', { maxDecompressedBytes: 1_000_000 });
  });

  it('rejects damaged or unsupported archives', () => {
    expectCode(fixture(FIXTURE_FILES.truncated), 'MALFORMED_XLSX');

    const encrypted = workbook(TWO_DAYS);
    const view = new DataView(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength);
    const directory = view.getUint32(encrypted.length - 22 + 16, true);
    view.setUint16(directory + 8, view.getUint16(directory + 8, true) | 1, true);
    expectCode(encrypted, 'MALFORMED_XLSX');
  });

  it('rejects DOCTYPE declarations instead of expanding entities', () => {
    const files = {
      'xl/workbook.xml': new TextEncoder().encode(
        '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]>' +
          '<workbook><sheets><sheet name="a" r:id="rId1"/></sheets></workbook>',
      ),
    };
    expectCode(zipSync(files), 'MALFORMED_XLSX');
  });

  it('rejects missing columns', () => {
    expectCode(fixture(FIXTURE_FILES.missingColumn), 'MISSING_COLUMNS');
    const rows = [['Data', 'Hora', 'Estado'], ['2025/01/15', '00:15', 'Real']];
    expectCode(buildXlsx({ sheetName: 'S', rows, strings: 'inline' }), 'MISSING_COLUMNS');
  });

  it('rejects unknown columns and reports only their position', () => {
    const error = expectCode(fixture(FIXTURE_FILES.unknownColumn), 'UNKNOWN_COLUMN');
    expect(error.details).toEqual({ row: 15, column: 4 });
    expect(error.message).toBe('UNKNOWN_COLUMN');
    expect(JSON.stringify(error.details)).not.toContain('Temperatura');
  });

  it('rejects readings that are not 15 minutes apart', () => {
    expectCode(fixture(FIXTURE_FILES.hourly), 'NOT_15_MINUTE');
    const offGrid = TWO_DAYS.map((r, i) => (i === 5 ? { ...r, time: '01:35' } : r));
    expectCode(workbook(offGrid), 'NOT_15_MINUTE');
    expectCode(workbook(TWO_DAYS, { intervalLabel: '60 min' }), 'NOT_15_MINUTE');
    // Hourly apart from one adjacent quarter-hour pair (00:45 and 01:00 on the first day).
    const mostlyHourly = TWO_DAYS.filter((r, i) => r.time.endsWith(':00') || i === 2);
    expect(mostlyHourly.slice(0, 3).map((r) => r.time)).toEqual(['00:45', '01:00', '02:00']);
    expectCode(workbook(mostlyHourly), 'NOT_15_MINUTE');
  });

  it('rejects unparseable or negative values', () => {
    expectCode(fixture(FIXTURE_FILES.badValue), 'INVALID_VALUE');
    for (const value of ['n/d', '1.234,5', '1e3', '-0,5', 'NaN', '0x10']) {
      const rows = [['Data', 'Hora', 'Consumo registado (kW)'], ['2025/01/15', '00:15', value]];
      const error = expectCode(buildXlsx({ sheetName: 'S', rows, strings: 'inline' }), 'INVALID_VALUE');
      expect(error.details).toEqual({ row: 2, column: 3 });
    }
  });

  it('rejects unparseable dates and times', () => {
    expectCode(fixture(FIXTURE_FILES.badDate), 'INVALID_DATE');
    for (const [date, time] of [
      ['ontem', '00:15'],
      ['2025/13/01', '00:15'],
      ['1999/01/01', '00:15'],
      ['2025/01/15', '25:00'],
      ['2025/01/15', '10:15:30'],
      ['2025/01/15', ''],
    ]) {
      const rows = [['Data', 'Hora', 'Consumo registado (kW)'], [date, time, '0,5']];
      expectCode(buildXlsx({ sheetName: 'S', rows, strings: 'inline' }), 'INVALID_DATE');
    }
  });

  it('rejects files with more rows than allowed', () => {
    expectCode(workbook(TWO_DAYS), 'TOO_MANY_ROWS', { maxRows: 100 });
  });

  it('rejects a file without readings', () => {
    expectCode(workbook([]), 'NO_DATA');
    expectCode(workbook(TWO_DAYS.map((r) => ({ ...r, kw: null }))), 'NO_DATA');
  });

  it('treats script-like text as plain data and never evaluates it', () => {
    const globals = globalThis as { __pwned?: boolean };
    const payloads = ['${globalThis.__pwned = true}', '<script>globalThis.__pwned = true</script>', '__proto__'];
    for (const payload of payloads) {
      const asHeader = [['Data', 'Hora', payload], ['2025/01/15', '00:15', '0,5']];
      expectCode(buildXlsx({ sheetName: payload, rows: asHeader, strings: 'shared' }), 'UNKNOWN_COLUMN');
      const asValue = [['Data', 'Hora', 'Consumo registado (kW)'], ['2025/01/15', '00:15', payload]];
      expectCode(buildXlsx({ sheetName: 'S', rows: asValue, strings: 'inline' }), 'INVALID_VALUE');
    }
    expect(globals.__pwned).toBeUndefined();
  });
});

describe('engine sources', () => {
  it('use no dynamic evaluation or DOM parsing APIs', () => {
    const dir = resolve(process.cwd(), 'src/app/engine');
    const sources = readdirSync(dir).filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'));
    expect(sources.length).toBeGreaterThan(0);
    for (const name of sources) {
      const text = readFileSync(join(dir, name), 'utf8');
      expect(text, name).not.toMatch(/\beval\s*\(|new\s+Function\b|\bFunction\s*\(|innerHTML|DOMParser|\bdocument\.|\bwindow\./);
    }
  });
});

/**
 * Deterministic synthetic E-Redes style files for tests and for `npm run fixtures`.
 *
 * Self-contained on purpose: it imports nothing from the parser, so the parser is tested
 * against an independent implementation (Lisbon time comes from Intl, not from engine code).
 * Only erasable TypeScript syntax is used, so Node can run it directly with type stripping.
 * Every value here is generated; no real consumption data is involved.
 */
import { zipSync } from 'fflate';

export type Cell = string | number | null;

export interface XlsxOptions {
  sheetName: string;
  rows: Cell[][];
  strings: 'inline' | 'shared';
  date1904?: boolean;
}

/** Fixed archive timestamp so generated files are byte-identical across runs. */
const FIXED_MTIME = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function columnName(index: number): string {
  let name = '';
  let n = index + 1;
  while (n > 0) {
    const rest = (n - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

const encoder = new TextEncoder();

/** Builds a minimal, valid single-sheet .xlsx workbook. */
export function buildXlsx(options: XlsxOptions): Uint8Array {
  const shared: string[] = [];
  const sharedIndex = new Map<string, number>();
  const rowXml: string[] = [];
  options.rows.forEach((row, rowIndex) => {
    const r = rowIndex + 1;
    const cells: string[] = [];
    row.forEach((cell, columnIndex) => {
      if (cell === null) {
        return;
      }
      const ref = `${columnName(columnIndex)}${r}`;
      if (typeof cell === 'number') {
        cells.push(`<c r="${ref}"><v>${cell}</v></c>`);
      } else if (options.strings === 'shared') {
        let index = sharedIndex.get(cell);
        if (index === undefined) {
          index = shared.length;
          shared.push(cell);
          sharedIndex.set(cell, index);
        }
        cells.push(`<c r="${ref}" t="s"><v>${index}</v></c>`);
      } else {
        cells.push(`<c r="${ref}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`);
      }
    });
    rowXml.push(cells.length ? `<row r="${r}">${cells.join('')}</row>` : `<row r="${r}"/>`);
  });

  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const hasShared = options.strings === 'shared';
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': encoder.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        (hasShared
          ? '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
          : '') +
        '</Types>',
    ),
    '_rels/.rels': encoder.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/>` +
        '</Relationships>',
    ),
    'xl/workbook.xml': encoder.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<workbook xmlns="${main}" xmlns:r="${rel}">` +
        (options.date1904 ? '<workbookPr date1904="1"/>' : '<workbookPr/>') +
        `<sheets><sheet name="${escapeXml(options.sheetName)}" sheetId="1" r:id="rId1"/></sheets>` +
        '</workbook>',
    ),
    'xl/_rels/workbook.xml.rels': encoder.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/>` +
        (hasShared ? `<Relationship Id="rId3" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/>` : '') +
        '</Relationships>',
    ),
    'xl/styles.xml': encoder.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<styleSheet xmlns="${main}">` +
        '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
        '</styleSheet>',
    ),
    'xl/worksheets/sheet1.xml': encoder.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<worksheet xmlns="${main}" xmlns:r="${rel}"><sheetData>${rowXml.join('')}</sheetData></worksheet>`,
    ),
  };
  if (hasShared) {
    files['xl/sharedStrings.xml'] = encoder.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<sst xmlns="${main}" count="${shared.length}" uniqueCount="${shared.length}">` +
        shared.map((text) => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`).join('') +
        '</sst>',
    );
  }
  return zipSync(files, { level: 6, mtime: FIXED_MTIME });
}

/** Builds a ZIP that is not a spreadsheet (no xl/workbook.xml). */
export function buildNonSpreadsheetZip(): Uint8Array {
  return zipSync({ 'word/document.xml': encoder.encode('<document/>') }, { level: 6, mtime: FIXED_MTIME });
}

// ---------------------------------------------------------------------------
// Lisbon quarter-hour labels (independent oracle based on Intl)
// ---------------------------------------------------------------------------

const lisbonFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Lisbon',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function lisbonWall(utcMs: number): Wall {
  const parts: Record<string, number> = {};
  for (const part of lisbonFormat.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') {
      parts[part.type] = Number(part.value);
    }
  }
  return { year: parts['year'], month: parts['month'], day: parts['day'], hour: parts['hour'], minute: parts['minute'] };
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export interface QuarterLabel {
  /** Interval start, UTC ms. */
  startUtc: number;
  /** Local date of the interval start, YYYY-MM-DD. */
  localDate: string;
  /** Local hour (fractional) of the interval start on the wall clock. */
  localHour: number;
  /** Export label: date of the interval end, YYYY/MM/DD. */
  date: string;
  /** Export label: wall time of the interval end, HH:MM (00:00 closes the previous day). */
  time: string;
}

/**
 * Quarter-hours whose local start date is in [fromDate, toDate), labelled by interval end as in
 * the export. The end label uses the wall clock of the interval start plus 15 minutes, so the
 * spring-forward day reads ... 00:45, 01:00, 02:15 ... and the autumn day repeats 01:15 to 02:00.
 */
export function lisbonQuarterLabels(fromDate: string, toDate: string): QuarterLabel[] {
  const [fy, fm, fd] = fromDate.split('-').map(Number);
  // Local midnight is 00:00 UTC in winter or 23:00 UTC the day before in summer.
  let utc = Date.UTC(fy, fm - 1, fd) - 3_600_000;
  if (lisbonWall(utc).day !== fd) {
    utc += 3_600_000;
  }
  const labels: QuarterLabel[] = [];
  for (;;) {
    const start = lisbonWall(utc);
    const localDate = `${start.year}-${pad2(start.month)}-${pad2(start.day)}`;
    if (localDate >= toDate) {
      break;
    }
    const endWall = new Date(Date.UTC(start.year, start.month - 1, start.day, start.hour, start.minute + 15));
    labels.push({
      startUtc: utc,
      localDate,
      localHour: start.hour + start.minute / 60,
      date: `${endWall.getUTCFullYear()}/${pad2(endWall.getUTCMonth() + 1)}/${pad2(endWall.getUTCDate())}`,
      time: `${pad2(endWall.getUTCHours())}:${pad2(endWall.getUTCMinutes())}`,
    });
    utc += 15 * 60_000;
  }
  return labels;
}

// ---------------------------------------------------------------------------
// Synthetic load profile
// ---------------------------------------------------------------------------

/** Small deterministic PRNG (mulberry32). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Synthetic household values never exceed this, so marker values above it are unique. */
export const SYNTHETIC_MAX_KW = 5.5;

function dayOfYear(localDate: string): number {
  const [y, m, d] = localDate.split('-').map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000;
}

function weekday(localDate: string): number {
  const [y, m, d] = localDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Average kW for a quarter-hour, rounded to 3 decimals like the export. */
export function syntheticKw(label: QuarterLabel, random: () => number): number {
  const h = label.localHour;
  const season = 1 + 0.35 * Math.cos((2 * Math.PI * (dayOfYear(label.localDate) - 15)) / 365);
  const weekend = weekday(label.localDate) % 6 === 0;
  let kw = 0.18;
  kw += 0.6 * Math.exp(-((h - 7.5) ** 2) / 1.5);
  kw += 1.4 * Math.exp(-((h - 20) ** 2) / 3);
  if (weekend) {
    kw += 0.5 * Math.exp(-((h - 13) ** 2) / 4);
  }
  kw *= season * (0.85 + 0.3 * random());
  if (random() < 0.01) {
    kw += 1.5;
  }
  return Math.round(Math.min(SYNTHETIC_MAX_KW, Math.max(0.02, kw)) * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// E-Redes style workbooks
// ---------------------------------------------------------------------------

export interface Reading {
  date: string;
  time: string;
  /** Average kW; null leaves the value cell empty. */
  kw: number | null;
  status?: 'Real' | 'Estimado';
}

export const DETAILED_HEADER: readonly string[] = [
  'Data',
  'Hora',
  'Consumo medido na IC, Ativa (kW)',
  'Estado',
  'Injeção na rede medida na IC, Ativa (kW)',
  'Estado',
  'Consumo registado (kW)',
  'Estado',
  'Injeção registada (kW)',
  'Estado',
];

export const SIMPLE_HEADER: readonly string[] = ['Data', 'Hora', 'Consumo registado (kW)', 'Estado'];

export interface EredesWorkbookOptions {
  layout: 'detailed' | 'simple';
  /** 1-based row of the column header (15 in the documented layout). */
  headerRow: number;
  values: 'comma-text' | 'dot-text' | 'number';
  dates: 'text' | 'excel-serial';
  strings: 'inline' | 'shared';
  sheetName: string;
  /** Overrides the header cells (used for malformed fixtures). */
  header?: readonly string[];
  /** Value written next to "Intervalo:" in the metadata block. */
  intervalLabel?: string;
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function formatKw(kw: number, mode: EredesWorkbookOptions['values']): Cell {
  if (mode === 'number') {
    return kw;
  }
  const text = String(kw);
  return mode === 'comma-text' ? text.replace('.', ',') : text;
}

function dateCell(date: string, mode: EredesWorkbookOptions['dates']): Cell {
  if (mode === 'text') {
    return date;
  }
  const [y, m, d] = date.split('/').map(Number);
  return (Date.UTC(y, m - 1, d) - EXCEL_EPOCH_MS) / 86_400_000;
}

function timeCell(time: string, mode: EredesWorkbookOptions['dates']): Cell {
  if (mode === 'text') {
    return time;
  }
  const [h, m] = time.split(':').map(Number);
  return (h * 60 + m) / 1440;
}

export function buildEredesWorkbook(readings: readonly Reading[], options: EredesWorkbookOptions): Uint8Array {
  const header = options.header ?? (options.layout === 'detailed' ? DETAILED_HEADER : SIMPLE_HEADER);
  const metadata: Cell[][] = [
    ['Dados Globais'],
    [],
    ['CPE', 'PT0000000000000000SY'],
    ['Funções', 'Consumo medido na IC, Ativa'],
    [null, 'Estado'],
    [null, 'Injeção na rede medida na IC, Ativa'],
    [null, 'Estado'],
    [null, 'Consumo registado'],
    [null, 'Estado'],
    [null, 'Injeção registada'],
    [null, 'Estado'],
    ['Mês/Ano', 'Ficheiro sintético'],
    ['Intervalo:', options.intervalLabel ?? '15 min'],
  ];
  const before = options.headerRow - 1;
  const top: Cell[][] = [];
  for (let i = 0; i < before; i++) {
    // Keep the "Intervalo:" row just above the blank separator, as in the documented layout.
    const fromEnd = before - 1 - i;
    top.push(fromEnd === 0 ? [] : (metadata[metadata.length - fromEnd] ?? []));
  }

  const rows: Cell[][] = [...top, [...header]];
  for (const reading of readings) {
    const value = reading.kw === null ? null : formatKw(reading.kw, options.values);
    const status = reading.kw === null ? null : (reading.status ?? 'Real');
    const date = dateCell(reading.date, options.dates);
    const time = timeCell(reading.time, options.dates);
    if (options.layout === 'detailed') {
      const zero = formatKw(0, options.values);
      rows.push([date, time, value, status, zero, 'Real', value, status, zero, 'Real']);
    } else {
      rows.push([date, time, value, status]);
    }
  }
  return buildXlsx({ sheetName: options.sheetName, rows, strings: options.strings });
}

/** Readings for every quarter-hour with local start date in [fromDate, toDate). */
export function syntheticReadings(fromDate: string, toDate: string, seed: number): Reading[] {
  const random = seededRandom(seed);
  return lisbonQuarterLabels(fromDate, toDate).map((label) => {
    const kw = syntheticKw(label, random);
    return { date: label.date, time: label.time, kw, status: random() < 0.002 ? 'Estimado' : 'Real' };
  });
}

// ---------------------------------------------------------------------------
// Fixture set
// ---------------------------------------------------------------------------

/**
 * Marker readings in the full-year file. They exceed SYNTHETIC_MAX_KW and form a unique run of
 * four consecutive quarter-hours, so a privacy test can search outgoing traffic for them.
 */
export const YEAR_MARKERS = {
  date: '2025/06/15',
  times: ['12:15', '12:30', '12:45', '13:00'],
  kw: [9.871, 9.872, 9.873, 9.874],
  /** As written in the file (decimal comma). */
  kwText: ['9,871', '9,872', '9,873', '9,874'],
  /** Same values with a decimal point, as a JavaScript number would print. */
  kwNumberText: ['9.871', '9.872', '9.873', '9.874'],
} as const;

/**
 * Strings a privacy test searches for in outgoing traffic: the unique marker kW values only.
 * Derived kWh values (kW / 4, such as 2.468) are not used because ordinary readings can
 * produce the same numbers.
 */
export const YEAR_LEAK_NEEDLES: readonly string[] = [...YEAR_MARKERS.kwText, ...YEAR_MARKERS.kwNumberText];

export const FIXTURE_FILES = {
  year: 'synthetic-year-2025.xlsx',
  partial: 'synthetic-partial-2025-q1.xlsx',
  gaps: 'synthetic-gaps-2025-02.xlsx',
  duplicates: 'synthetic-duplicates-2025-05.xlsx',
  notXlsx: 'malformed-not-xlsx.xlsx',
  noWorkbook: 'malformed-no-workbook.xlsx',
  truncated: 'malformed-truncated.xlsx',
  missingColumn: 'malformed-missing-column.xlsx',
  unknownColumn: 'malformed-unknown-column.xlsx',
  hourly: 'malformed-hourly.xlsx',
  badValue: 'malformed-bad-value.xlsx',
  badDate: 'malformed-bad-date.xlsx',
} as const;

/** Removed from the gaps file: a whole day, a 3-hour block and three single quarter-hours. */
export const GAP_FIXTURE = {
  removedDay: '2025-02-10',
  removedBlock: { date: '2025/02/20', fromTime: '18:15', count: 12 },
  removedSingles: [
    { date: '2025/02/05', time: '03:30' },
    { date: '2025/02/14', time: '12:00' },
    { date: '2025/02/25', time: '23:45' },
  ],
  emptyValues: [
    { date: '2025/02/03', time: '08:15' },
    { date: '2025/02/27', time: '19:00' },
  ],
  expectedMissing: 96 + 12 + 3 + 2,
} as const;

/** Rows repeated in the duplicates file (first occurrence wins). */
export const DUPLICATE_FIXTURE = {
  repeated: [
    { date: '2025/05/02', time: '10:00' },
    { date: '2025/05/04', time: '21:30' },
    { date: '2025/05/06', time: '00:00' },
  ],
} as const;

const DETAILED: EredesWorkbookOptions = {
  layout: 'detailed',
  headerRow: 15,
  values: 'comma-text',
  dates: 'text',
  strings: 'inline',
  sheetName: 'Leituras',
};

function yearReadings(): Reading[] {
  const readings = syntheticReadings('2025-01-01', '2026-01-01', 2025);
  for (const reading of readings) {
    const marker = (YEAR_MARKERS.times as readonly string[]).indexOf(reading.time);
    if (reading.date === YEAR_MARKERS.date && marker >= 0) {
      reading.kw = YEAR_MARKERS.kw[marker];
      reading.status = 'Real';
    }
  }
  return readings;
}

function gapReadings(): Reading[] {
  const labels = lisbonQuarterLabels('2025-02-01', '2025-03-01');
  const block = GAP_FIXTURE.removedBlock;
  const blockStart = labels.findIndex((l) => l.date === block.date && l.time === block.fromTime);
  const blockLabels = new Set(labels.slice(blockStart, blockStart + block.count));
  const random = seededRandom(202502);
  const readings: Reading[] = [];
  for (const label of labels) {
    const kw = syntheticKw(label, random);
    const isSingle = GAP_FIXTURE.removedSingles.some((s) => s.date === label.date && s.time === label.time);
    if (label.localDate === GAP_FIXTURE.removedDay || blockLabels.has(label) || isSingle) {
      continue;
    }
    const isEmpty = GAP_FIXTURE.emptyValues.some((s) => s.date === label.date && s.time === label.time);
    readings.push({ date: label.date, time: label.time, kw: isEmpty ? null : kw });
  }
  return readings;
}

function duplicateReadings(): Reading[] {
  const readings: Reading[] = [];
  for (const reading of syntheticReadings('2025-05-01', '2025-05-08', 202505)) {
    readings.push(reading);
    if (DUPLICATE_FIXTURE.repeated.some((d) => d.date === reading.date && d.time === reading.time)) {
      // A repeated row with a different value: the first reading must be kept.
      readings.push({ ...reading, kw: Math.round((reading.kw ?? 0) * 2000) / 1000 });
    }
  }
  return readings;
}

function hourlyReadings(): Reading[] {
  const readings: Reading[] = [];
  for (let hour = 1; hour <= 24; hour++) {
    readings.push({
      date: hour === 24 ? '2025/01/02' : '2025/01/01',
      time: `${pad2(hour % 24)}:00`,
      kw: (40 + hour) / 100,
    });
  }
  return readings;
}

export function buildFixtureSet(): Record<string, Uint8Array> {
  const oneDay = syntheticReadings('2025-01-15', '2025-01-16', 115);
  const badValue = oneDay.map((r) => ({ ...r }));
  const badDate = oneDay.map((r) => ({ ...r }));
  badDate[40] = { ...badDate[40], date: '2025/02/30' };
  const valid = buildEredesWorkbook(oneDay, DETAILED);

  const files: Record<string, Uint8Array> = {
    [FIXTURE_FILES.year]: buildEredesWorkbook(yearReadings(), DETAILED),
    [FIXTURE_FILES.partial]: buildEredesWorkbook(syntheticReadings('2025-01-01', '2025-04-01', 2501), {
      layout: 'simple',
      headerRow: 9,
      values: 'number',
      dates: 'excel-serial',
      strings: 'shared',
      sheetName: 'Leituras',
    }),
    [FIXTURE_FILES.gaps]: buildEredesWorkbook(gapReadings(), { ...DETAILED, values: 'dot-text', sheetName: 'Dados de Energia' }),
    [FIXTURE_FILES.duplicates]: buildEredesWorkbook(duplicateReadings(), { ...DETAILED, strings: 'shared' }),
    [FIXTURE_FILES.notXlsx]: encoder.encode('Data;Hora;Consumo registado (kW);Estado\r\n2025/01/01;00:15;0,312;Real\r\n'),
    [FIXTURE_FILES.noWorkbook]: buildNonSpreadsheetZip(),
    [FIXTURE_FILES.truncated]: valid.slice(0, Math.floor(valid.length / 2)),
    [FIXTURE_FILES.missingColumn]: buildEredesWorkbook(oneDay, {
      ...DETAILED,
      layout: 'simple',
      header: ['Data', 'Horário', 'Consumo registado (kW)', 'Estado'],
    }),
    [FIXTURE_FILES.unknownColumn]: buildEredesWorkbook(oneDay, {
      ...DETAILED,
      layout: 'simple',
      header: ['Data', 'Hora', 'Consumo registado (kW)', 'Temperatura (°C)'],
    }),
    [FIXTURE_FILES.hourly]: buildEredesWorkbook(hourlyReadings(), { ...DETAILED, intervalLabel: '' }),
    [FIXTURE_FILES.badValue]: buildEredesWorkbook(
      badValue.map((r, i) => (i === 30 ? { ...r, kw: -1 } : r)),
      { ...DETAILED, values: 'comma-text' },
    ),
    [FIXTURE_FILES.badDate]: buildEredesWorkbook(badDate, DETAILED),
  };
  return files;
}

export function fixtureReadme(): string {
  return [
    '# Synthetic fixtures',
    '',
    'Generated by `npm --prefix web run fixtures` (source: `web/src/testing/synthetic-fixtures.ts`).',
    'Every value is synthetic. Never add real consumption files to this folder.',
    '',
    '| File | Content |',
    '| --- | --- |',
    `| ${FIXTURE_FILES.year} | Full calendar year 2025 in Lisbon time (35 040 quarter-hours, 92 on 30 March, 100 on 26 October), documented 10-column layout, header on row 15, decimal comma text. Contains the privacy marker run below. |`,
    `| ${FIXTURE_FILES.partial} | 1 January to 31 March 2025, 4-column layout, header on row 9, numeric cells, Excel serial dates, shared strings. |`,
    `| ${FIXTURE_FILES.gaps} | February 2025 with ${GAP_FIXTURE.expectedMissing} missing quarter-hours (10 February, 3 hours on 20 February, 3 single readings, 2 empty values), decimal point text. |`,
    `| ${FIXTURE_FILES.duplicates} | 1 to 7 May 2025 with 3 repeated rows carrying different values (the first is kept). |`,
    `| ${FIXTURE_FILES.notXlsx} | CSV text with an .xlsx name. |`,
    `| ${FIXTURE_FILES.noWorkbook} | ZIP archive that is not a spreadsheet. |`,
    `| ${FIXTURE_FILES.truncated} | First half of a valid file. |`,
    `| ${FIXTURE_FILES.missingColumn} | Header without the "Hora" column. |`,
    `| ${FIXTURE_FILES.unknownColumn} | Header with an unknown column. |`,
    `| ${FIXTURE_FILES.hourly} | Hourly readings instead of 15-minute readings. |`,
    `| ${FIXTURE_FILES.badValue} | A negative consumption value. |`,
    `| ${FIXTURE_FILES.badDate} | The date 2025/02/30. |`,
    '',
    '## Privacy marker',
    '',
    `${FIXTURE_FILES.year} holds four consecutive readings on ${YEAR_MARKERS.date} ending at ${YEAR_MARKERS.times.join(', ')}`,
    `with the values ${YEAR_MARKERS.kwText.join(', ')} kW. Synthetic readings never exceed ${SYNTHETIC_MAX_KW} kW,`,
    'so these values appear nowhere else. A leak detector searches for these kW values only (`YEAR_LEAK_NEEDLES`',
    'in the generator), never for derived kWh values, which ordinary readings can also produce.',
    '',
  ].join('\n');
}

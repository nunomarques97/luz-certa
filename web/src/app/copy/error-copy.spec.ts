import { ENGINE_ERROR_CODES } from '../engine/engine-errors';
import { PARSE_ERROR_CODES } from '../engine/parse-errors';
import type { EngineFailure } from '../worker/engine-protocol';
import { AppFailure, errorCopy } from './error-copy';

/** En and em dashes, built from char codes so this file holds neither character. */
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

const ALL_FAILURES: AppFailure[] = [
  ...PARSE_ERROR_CODES.map((code): AppFailure => ({ kind: 'parse', code, details: {} })),
  ...ENGINE_ERROR_CODES.map((code): AppFailure => ({ kind: 'engine', code })),
  { kind: 'data', code: 'DATA_UNAVAILABLE' },
  { kind: 'internal', code: 'INVALID_REQUEST' },
  { kind: 'internal', code: 'INTERNAL' },
  { kind: 'internal', code: 'WORKER_FAILED' },
  { kind: 'file', code: 'FILE_UNREADABLE' },
];

describe('errorCopy', () => {
  it('maps every parser, engine, data and internal code to Portuguese copy with a recovery path', () => {
    const titles = new Set<string>();
    for (const failure of ALL_FAILURES) {
      const copy = errorCopy(failure);
      expect(copy.title.length, failure.code).toBeGreaterThan(10);
      expect(copy.detail.length, failure.code).toBeGreaterThan(10);
      expect(['choose-file', 'edit-settings', 'retry']).toContain(copy.recovery);
      expect(copy.title + copy.detail, failure.code).not.toMatch(DASHES);
      // No English code or identifier leaks into the copy.
      expect(copy.title + copy.detail, failure.code).not.toContain(failure.code);
      titles.add(copy.title);
    }
    // Most codes get their own title, so the user can tell the problems apart.
    expect(titles.size).toBeGreaterThanOrEqual(15);
  });

  it('sends file problems to another file, settings problems to the form, and the rest to retry', () => {
    expect(errorCopy({ kind: 'parse', code: 'NOT_15_MINUTE', details: {} }).recovery).toBe(
      'choose-file',
    );
    expect(errorCopy({ kind: 'engine', code: 'PERIOD_OUTSIDE_CATALOGUE' }).recovery).toBe(
      'choose-file',
    );
    for (const code of [
      'UNSUPPORTED_POWER',
      'UNKNOWN_OFFER',
      'CURRENT_OFFER_UNAVAILABLE',
      'INVALID_MANUAL_PRICES',
    ] as const) {
      expect(errorCopy({ kind: 'engine', code }).recovery).toBe('edit-settings');
    }
    expect(errorCopy({ kind: 'data', code: 'DATA_UNAVAILABLE' }).recovery).toBe('retry');
    expect(errorCopy({ kind: 'internal', code: 'WORKER_FAILED' }).recovery).toBe('retry');
  });

  it('adds the row and column of a parse error, numbers only', () => {
    const failure: EngineFailure = {
      kind: 'parse',
      code: 'INVALID_VALUE',
      details: { row: 120, column: 3 },
    };
    expect(errorCopy(failure).detail).toContain('Linha 120, coluna 3.');
    expect(
      errorCopy({ kind: 'parse', code: 'UNKNOWN_COLUMN', details: { column: 7 } }).detail,
    ).toContain('Coluna 7.');
  });

  it('names the catalogue dates when the period is not covered', () => {
    const copy = errorCopy(
      { kind: 'engine', code: 'PERIOD_OUTSIDE_CATALOGUE' },
      { cataloguePeriod: { from: '2024-01-01', to: '2026-12-31' } },
    );
    expect(copy.detail).toContain('de 1 de janeiro de 2024 a 31 de dezembro de 2026');
  });
});

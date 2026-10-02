/**
 * Typed rejection reasons for the consumption file parser. The UI maps each code to its own copy;
 * error details only carry numbers (row and column positions), never text taken from the file.
 */
export const PARSE_ERROR_CODES = [
  /** Input is not a ZIP-based .xlsx file (wrong signature, e.g. CSV, .xls or PDF). */
  'NOT_XLSX',
  /** Input exceeds the accepted file size. */
  'FILE_TOO_LARGE',
  /** Decompressed content exceeds the accepted size (zip bomb protection). */
  'DECOMPRESSED_TOO_LARGE',
  /** ZIP or spreadsheet structure is damaged, encrypted or unsupported. */
  'MALFORMED_XLSX',
  /** The header row or one of the required columns (Data, Hora, consumption) is missing. */
  'MISSING_COLUMNS',
  /** The header row contains a column this parser does not know. */
  'UNKNOWN_COLUMN',
  /** Readings are not spaced 15 minutes apart. */
  'NOT_15_MINUTE',
  /** A date or time cannot be read or does not exist in Lisbon local time. */
  'INVALID_DATE',
  /** A consumption value cannot be read as a non-negative number. */
  'INVALID_VALUE',
  /** The file has more rows than any supported export can contain. */
  'TOO_MANY_ROWS',
  /** The file has a valid header but no readings. */
  'NO_DATA',
] as const;

export type ParseErrorCode = (typeof PARSE_ERROR_CODES)[number];

export interface ParseErrorDetails {
  /** 1-based spreadsheet row number. */
  row?: number;
  /** 1-based spreadsheet column number. */
  column?: number;
}

export class ConsumptionParseError extends Error {
  readonly code: ParseErrorCode;
  readonly details: ParseErrorDetails;

  constructor(code: ParseErrorCode, details: ParseErrorDetails = {}) {
    super(code);
    this.name = 'ConsumptionParseError';
    this.code = code;
    this.details = details;
  }
}

export function isConsumptionParseError(error: unknown): error is ConsumptionParseError {
  return error instanceof ConsumptionParseError;
}

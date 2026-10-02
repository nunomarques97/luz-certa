import type { CostAnalysis, CostSettings } from '../engine/cost-engine';
import type { EngineErrorCode } from '../engine/engine-errors';
import type { ParseErrorCode, ParseErrorDetails } from '../engine/parse-errors';

/**
 * Messages between the app and the engine worker. Every request carries an id and every response
 * echoes it, so the client can discard responses to requests it no longer waits for.
 * Consumption bytes only travel between the page and its own worker; nothing here is sent over
 * the network.
 */

export interface AnalyseRequest {
  type: 'analyse';
  /** Request id, unique per client. */
  id: number;
  /** Identifies the selected file. The worker reuses the parsed file while the id is unchanged. */
  fileId: number;
  /** Raw .xlsx bytes. */
  bytes: ArrayBuffer;
  settings: CostSettings;
}

export type EngineFailure =
  /** The file was rejected by the parser. Details hold row and column numbers only. */
  | { kind: 'parse'; code: ParseErrorCode; details: ParseErrorDetails }
  /** The settings or the period cannot be priced with the catalogue. */
  | { kind: 'engine'; code: EngineErrorCode }
  /** The catalogue or OMIE data could not be loaded from the app's own server. */
  | { kind: 'data'; code: 'DATA_UNAVAILABLE' }
  /** Malformed request, unexpected exception, or the worker stopped or could not start. */
  | { kind: 'internal'; code: 'INVALID_REQUEST' | 'INTERNAL' | 'WORKER_FAILED' };

export type EngineResponse =
  { id: number; ok: true; result: CostAnalysis } | { id: number; ok: false; error: EngineFailure };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isAnalyseRequest(value: unknown): value is AnalyseRequest {
  if (!isObject(value) || value['type'] !== 'analyse') {
    return false;
  }
  const settings = value['settings'];
  if (
    !isObject(settings) ||
    typeof settings['contractedKva'] !== 'number' ||
    typeof settings['largeFamily'] !== 'boolean'
  ) {
    return false;
  }
  const current = settings['current'];
  const validCurrent =
    isObject(current) &&
    ((current['kind'] === 'offer' && typeof current['offerId'] === 'string') ||
      (current['kind'] === 'manual' && isObject(current['tariff'])));
  return (
    Number.isSafeInteger(value['id']) &&
    Number.isSafeInteger(value['fileId']) &&
    value['bytes'] instanceof ArrayBuffer &&
    validCurrent
  );
}

export function isEngineResponse(value: unknown): value is EngineResponse {
  if (!isObject(value) || !Number.isSafeInteger(value['id'])) {
    return false;
  }
  return (
    (value['ok'] === true && isObject(value['result'])) ||
    (value['ok'] === false && isObject(value['error']))
  );
}

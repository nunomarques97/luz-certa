import type { Catalogue } from '../engine/catalogue-model';
import { calculateCosts } from '../engine/cost-engine';
import { isEngineError } from '../engine/engine-errors';
import { ParsedConsumption, parseEredesConsumption } from '../engine/eredes-parser';
import { OmiePriceLookup, OmieYearFile, marketDayOf } from '../engine/omie-time';
import { isConsumptionParseError } from '../engine/parse-errors';
import { EngineFailure, EngineResponse, isAnalyseRequest } from './engine-protocol';

/** Static data the engine needs, served by the app itself (web/public/data/). */
export interface EngineDataSource {
  loadCatalogue(): Promise<Catalogue>;
  loadOmieIndex(): Promise<{ years: number[] }>;
  loadOmieYear(year: number): Promise<OmieYearFile>;
}

export type EngineHandler = (message: unknown) => Promise<EngineResponse>;

class DataUnavailableError extends Error {}

/**
 * Builds the worker's request handler: parse, load data, calculate, and turn every outcome into a
 * response with the request id. It never rejects. The handler holds no state for a request after
 * responding: failed data loads are not cached, and only the last successfully parsed file is kept
 * (keyed by fileId) so a settings change does not parse the same file again.
 */
export function createEngineHandler(
  source: EngineDataSource,
  parse = parseEredesConsumption,
): EngineHandler {
  let catalogue: Promise<Catalogue> | null = null;
  let omieIndex: Promise<{ years: number[] }> | null = null;
  const omieYears = new Map<number, Promise<OmieYearFile>>();
  let parsedFile: { fileId: number; consumption: ParsedConsumption } | null = null;

  function cached<T>(
    load: () => Promise<T>,
    read: () => Promise<T> | null,
    store: (value: Promise<T> | null) => void,
  ): Promise<T> {
    const existing = read();
    if (existing) {
      return existing;
    }
    const loading = Promise.resolve()
      .then(load)
      .catch((error: unknown) => {
        // Forget the failure so a retry loads again, unless a newer load already replaced it.
        if (read() === loading) {
          store(null);
        }
        throw error;
      });
    store(loading);
    return loading;
  }

  async function loadData(
    consumption: ParsedConsumption,
  ): Promise<{ catalogue: Catalogue; omie: OmiePriceLookup }> {
    try {
      const [catalogueData, index] = await Promise.all([
        cached(
          () => source.loadCatalogue(),
          () => catalogue,
          (value) => (catalogue = value),
        ),
        cached(
          () => source.loadOmieIndex(),
          () => omieIndex,
          (value) => (omieIndex = value),
        ),
      ]);
      const { periodStartUtc, periodEndUtc } = consumption.metadata;
      const firstYear = Number(marketDayOf(periodStartUtc).slice(0, 4));
      const lastYear = Number(marketDayOf(periodEndUtc - 1).slice(0, 4));
      const years = index.years.filter((year) => year >= firstYear && year <= lastYear);
      const files = await Promise.all(
        years.map((year) =>
          cached(
            () => source.loadOmieYear(year),
            () => omieYears.get(year) ?? null,
            (value) => (value ? omieYears.set(year, value) : omieYears.delete(year)),
          ),
        ),
      );
      return { catalogue: catalogueData, omie: new OmiePriceLookup(files) };
    } catch {
      throw new DataUnavailableError();
    }
  }

  function parsedFor(fileId: number, bytes: ArrayBuffer): ParsedConsumption {
    if (parsedFile?.fileId === fileId) {
      return parsedFile.consumption;
    }
    const consumption = parse(bytes);
    parsedFile = { fileId, consumption };
    return consumption;
  }

  function failure(id: number, error: EngineFailure): EngineResponse {
    return { id, ok: false, error };
  }

  return async (message: unknown): Promise<EngineResponse> => {
    if (!isAnalyseRequest(message)) {
      const id =
        typeof message === 'object' && message !== null
          ? (message as { id?: unknown }).id
          : undefined;
      return failure(Number.isSafeInteger(id) ? (id as number) : -1, {
        kind: 'internal',
        code: 'INVALID_REQUEST',
      });
    }
    const { id } = message;
    try {
      const consumption = parsedFor(message.fileId, message.bytes);
      const data = await loadData(consumption);
      return { id, ok: true, result: calculateCosts(consumption, data, message.settings) };
    } catch (error) {
      if (isConsumptionParseError(error)) {
        return failure(id, { kind: 'parse', code: error.code, details: { ...error.details } });
      }
      if (isEngineError(error)) {
        return failure(id, { kind: 'engine', code: error.code });
      }
      if (error instanceof DataUnavailableError) {
        return failure(id, { kind: 'data', code: 'DATA_UNAVAILABLE' });
      }
      return failure(id, { kind: 'internal', code: 'INTERNAL' });
    }
  };
}

/** Data source that reads the static JSON files next to the app with same-origin GET requests. */
export function fetchDataSource(baseUrl: URL, fetchFn: typeof fetch = fetch): EngineDataSource {
  async function getJson<T>(path: string): Promise<T> {
    const response = await fetchFn(new URL(path, baseUrl), {
      method: 'GET',
      credentials: 'same-origin',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  }
  return {
    loadCatalogue: () => getJson<Catalogue>('data/catalogue.json'),
    loadOmieIndex: () => getJson<{ years: number[] }>('data/omie/index.json'),
    loadOmieYear: (year) => getJson<OmieYearFile>(`data/omie/${year}.json`),
  };
}
